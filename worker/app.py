"""Small, stateless geospatial worker. No uploaded file is retained."""
from __future__ import annotations

import csv
import base64
import io
import json
import math
import tempfile
from urllib.parse import urlparse
from typing import Any

import httpx
import numpy as np
import rasterio
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from pyproj import CRS, Geod, Transformer
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, shapes
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely import transform as shapely_transform
from shapely.geometry import Polygon, shape, mapping, box

app = FastAPI(title="Ferti geo worker")
GEOD = Geod(ellps="WGS84")
MAX_BYTES = 25 * 1024 * 1024
MAX_CELLS = 50000
GRID_M = 20
STAC_URL = "https://earth-search.aws.element84.com/v1/search"


def field_setup(raw: str):
    try:
        geom = shape(json.loads(raw))
    except Exception as exc:
        raise HTTPException(400, f"Polígono inválido: {exc}") from exc
    if not isinstance(geom, Polygon) or not geom.is_valid or geom.is_empty:
        raise HTTPException(400, "El lote debe ser un polígono válido.")
    area_m2 = abs(GEOD.geometry_area_perimeter(geom)[0])
    if area_m2 <= 0 or area_m2 > 500000:
        raise HTTPException(400, "El lote debe tener más de 0 y hasta 50 ha.")
    centroid = geom.centroid
    utm = CRS.from_epsg((32600 if centroid.y >= 0 else 32700) + int((centroid.x + 180) // 6) + 1)
    forward = Transformer.from_crs("EPSG:4326", utm, always_xy=True).transform
    inverse = Transformer.from_crs(utm, "EPSG:4326", always_xy=True).transform
    projected = shapely_transform(geom, forward, interleaved=False)
    minx, miny, maxx, maxy = projected.bounds
    west = math.floor(minx / GRID_M) * GRID_M
    north = math.ceil(maxy / GRID_M) * GRID_M
    width = math.ceil((maxx - west) / GRID_M)
    height = math.ceil((north - miny) / GRID_M)
    if width * height > MAX_CELLS:
        raise HTTPException(400, "El polígono es demasiado alargado para la grilla de 20 m.")
    transform = from_origin(west, north, GRID_M, GRID_M)
    # Include every 20 m cell touched by the field, then clip each cell to the
    # exact field geometry later. This prevents edge strips from being omitted
    # merely because a cell centre falls just outside the polygon.
    inside = geometry_mask([mapping(projected)], out_shape=(height, width), transform=transform, invert=True, all_touched=True)
    return geom, projected, utm, inverse, transform, inside, area_m2 / 10000


@app.post("/scenes")
async def scenes(geometry: dict[str, Any], date_from: str = "2025-01-01", date_to: str = "2026-12-31"):
    geom, *_ = field_setup(json.dumps(geometry))
    if date_from > date_to:
        raise HTTPException(400, "El rango de fechas es inválido.")
    body = {
        "collections": ["sentinel-2-c1-l2a"],
        "intersects": mapping(geom),
        "datetime": f"{date_from}T00:00:00Z/{date_to}T23:59:59Z",
        "limit": 40,
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        "query": {"eo:cloud_cover": {"lt": 60}},
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(STAC_URL, json=body)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        raise HTTPException(502, f"No se pudo consultar el catálogo satelital: {exc}") from exc
    result = []
    for item in data.get("features", []):
        assets = item.get("assets", {})
        if not all(k in assets for k in ("blue", "green", "red", "nir", "scl")):
            continue
        result.append({
            "id": item["id"], "date": item["properties"]["datetime"],
            "cloud": item["properties"].get("eo:cloud_cover"),
            "assets": {k: assets[k]["href"] for k in ("blue", "green", "red", "nir", "scl")},
        })
    return {"scenes": result}


def read_grid(uri: str, utm: CRS, transform, shape_out, resampling=Resampling.bilinear):
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff"):
        with rasterio.open(uri) as src:
            if src.crs is None:
                raise HTTPException(400, "El GeoTIFF no tiene sistema de coordenadas (CRS).")
            if src.count != 1:
                raise HTTPException(400, "El GeoTIFF debe tener una banda numérica.")
            with WarpedVRT(src, crs=utm, transform=transform, width=shape_out[1], height=shape_out[0], resampling=resampling) as vrt:
                return vrt.read(1, masked=True).astype("float32").filled(np.nan)


def csv_grid(content: bytes, target_crs: CRS, transform, inside, unit: str, csv_crs: str):
    try:
        source_crs = CRS.from_user_input(csv_crs)
        forward = Transformer.from_crs(source_crs, target_crs, always_xy=True).transform
        text = content.decode("utf-8-sig")
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        names = {str(n).strip().lower(): n for n in (reader.fieldnames or [])}
        def column(*candidates):
            for candidate in candidates:
                if candidate in names:
                    return names[candidate]
            return None
        lon_col = column("lon", "longitude", "longitud", "x")
        lat_col = column("lat", "latitude", "latitud", "y")
        value_col = column("yield", "rendimiento", "valor", "value")
        if not all((lon_col, lat_col, value_col)):
            raise HTTPException(400, "CSV: se requieren columnas lon, lat y rendimiento (o yield).")
        sums = np.zeros(inside.shape, dtype="float64")
        counts = np.zeros(inside.shape, dtype="int32")
        for row in reader:
            lon = float(row[lon_col].replace(",", "."))
            lat = float(row[lat_col].replace(",", "."))
            value = float(row[value_col].replace(",", "."))
            if not (math.isfinite(lon) and math.isfinite(lat) and math.isfinite(value) and value >= 0):
                continue
            if source_crs.is_geographic and not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue
            x, y = forward(lon, lat)
            col, r = ~transform @ (x, y)
            rr, cc = int(math.floor(r)), int(math.floor(col))
            if 0 <= rr < inside.shape[0] and 0 <= cc < inside.shape[1] and inside[rr, cc]:
                sums[rr, cc] += value * (1000 if unit == "t/ha" else 1)
                counts[rr, cc] += 1
        values = np.full(inside.shape, np.nan, dtype="float32")
        valid = counts > 0
        values[valid] = sums[valid] / counts[valid]
        return values
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"CSV inválido: {exc}") from exc


def satellite_preview(blue, green, red, scl, inside, inverse, transform):
    """Return a compact true-colour PNG, clipped to pixels valid for the analysis."""
    valid = inside & np.isin(scl, [4, 5]) & np.isfinite(blue) & np.isfinite(green) & np.isfinite(red)
    if not np.any(valid):
        return None
    rgba = np.zeros((4, *red.shape), dtype=np.uint8)
    for index, band in enumerate((red, green, blue)):
        low, high = np.percentile(band[valid], [2, 98])
        if high <= low:
            high = low + 1
        normalized = np.clip((band - low) / (high - low), 0, 1)
        normalized = np.nan_to_num(normalized, nan=0.0)
        rgba[index] = (np.power(normalized, 1 / 1.8) * 255).astype(np.uint8)
    rgba[3, valid] = 230
    height, width = red.shape
    east, south = transform @ (width, height)
    west, north = transform @ (0, 0)
    corners = [inverse(west, south), inverse(east, south), inverse(east, north), inverse(west, north)]
    lons, lats = zip(*corners)
    with MemoryFile() as memory:
        with memory.open(driver="PNG", width=width, height=height, count=4, dtype="uint8") as dataset:
            dataset.write(rgba)
        encoded = base64.b64encode(memory.read()).decode("ascii")
    return {"dataUrl": f"data:image/png;base64,{encoded}", "extentWgs84": [min(lons), min(lats), max(lons), max(lats)]}


def generate(geometry_raw, values, inside, projected, inverse, transform, area_ha, source, preview=None):
    valid = inside & np.isfinite(values)
    if not np.any(valid):
        raise HTTPException(400, "No hay datos válidos dentro del lote.")
    ordered = values[valid]
    cut1, cut2 = np.quantile(ordered, [1 / 3, 2 / 3])
    if cut1 == cut2:
        raise HTTPException(400, "Los valores no varían lo suficiente para formar tres ambientes.")
    labels = np.full(values.shape, -1, dtype="int8")
    labels[valid] = np.where(values[valid] < cut1, 0, np.where(values[valid] < cut2, 1, 2))
    if set(np.unique(labels[valid]).tolist()) != {0, 1, 2}:
        raise HTTPException(400, "La capa necesita valores más variados para formar tres ambientes.")
    cells = []
    areas = [0.0, 0.0, 0.0]
    for rr, cc in np.argwhere(inside):
        x0, y1 = transform @ (int(cc), int(rr))
        piece = box(x0, y1 - GRID_M, x0 + GRID_M, y1).intersection(projected)
        if piece.is_empty:
            continue
        area = piece.area / 10000
        label = int(labels[rr, cc])
        if label >= 0:
            areas[label] += area
        lon, lat = inverse(x0 + GRID_M / 2, y1 - GRID_M / 2)
        cells.append({"row": int(rr), "col": int(cc), "lon": round(lon, 7), "lat": round(lat, 7),
                      "value": round(float(values[rr, cc]), 4) if label >= 0 else None,
                      "class": label, "areaHa": round(area, 6),
                      "geometry": mapping(shapely_transform(piece, inverse, interleaved=False))})
    features = []
    for polygon, value in shapes(labels, mask=labels >= 0, transform=transform):
        label = int(value)
        clipped = shape(polygon).intersection(projected)
        if clipped.is_empty:
            continue
        geo = shapely_transform(clipped, inverse, interleaved=False)
        features.append({"type": "Feature", "geometry": mapping(geo), "properties": {"class": label}})
    return {"source": source, "areaHa": round(area_ha, 4), "validAreaHa": round(sum(areas), 4),
            "classAreaHa": [round(a, 4) for a in areas], "thresholds": [float(cut1), float(cut2)],
            "grid": {"width": values.shape[1], "height": values.shape[0], "cellM": GRID_M},
            "cells": cells, "zones": {"type": "FeatureCollection", "features": features}, "preview": preview}


@app.post("/process")
async def process(geometry: str = Form(...), source: str = Form(...),
                  scene: str | None = Form(None), unit: str = Form("kg/ha"),
                  csv_crs: str = Form("EPSG:4326"),
                  file: UploadFile | None = File(None)):
    geom, projected, utm, inverse, transform, inside, area_ha = field_setup(geometry)
    shape_out = inside.shape
    if source == "satellite":
        if not scene:
            raise HTTPException(400, "Falta la escena.")
        try:
            selected = json.loads(scene)
            assets = selected["assets"]
            if not all(urlparse(str(assets[k])).scheme == "https" and
                       urlparse(str(assets[k])).hostname and
                       urlparse(str(assets[k])).hostname.endswith(".amazonaws.com")
                       for k in ("blue", "green", "red", "nir", "scl")):
                raise ValueError("URL de banda inválida")
            blue = read_grid(assets["blue"], utm, transform, shape_out)
            green = read_grid(assets["green"], utm, transform, shape_out)
            red = read_grid(assets["red"], utm, transform, shape_out)
            nir = read_grid(assets["nir"], utm, transform, shape_out)
            scl = read_grid(assets["scl"], utm, transform, shape_out, Resampling.nearest)
            with np.errstate(divide="ignore", invalid="ignore"):
                values = (nir - red) / (nir + red)
            values[~np.isin(scl, [4, 5]) | (red + nir <= 0)] = np.nan
            preview = satellite_preview(blue, green, red, scl, inside, inverse, transform)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f"No se pudo procesar la escena: {exc}") from exc
    elif source in ("geotiff", "csv"):
        if file is None:
            raise HTTPException(400, "Falta el archivo.")
        if unit not in ("kg/ha", "t/ha"):
            raise HTTPException(400, "Unidad de rendimiento inválida.")
        content = await file.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise HTTPException(413, "El archivo supera 25 MB.")
        if source == "csv":
            values = csv_grid(content, utm, transform, inside, unit, csv_crs)
        else:
            with tempfile.NamedTemporaryFile(suffix=".tif") as temporary:
                temporary.write(content)
                temporary.flush()
                values = read_grid(temporary.name, utm, transform, shape_out)
                if unit == "t/ha":
                    values *= 1000
    else:
        raise HTTPException(400, "Fuente inválida.")
    return generate(geometry, values, inside, projected, inverse, transform, area_ha, source, preview if source == "satellite" else None)


@app.get("/health")
def health():
    return {"ok": True}
