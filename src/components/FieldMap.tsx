'use client';
import { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import XYZ from 'ol/source/XYZ';
import ImageStatic from 'ol/source/ImageStatic';
import type ImageSource from 'ol/source/Image';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Overlay from 'ol/Overlay';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import { Fill, Stroke, Style } from 'ol/style';
import { fromLonLat, transformExtent } from 'ol/proj';
import area from '@turf/area';
import type { Geometry, Analysis } from '@/lib/model';
import { colors } from '@/lib/model';

type Props = { geometry: Geometry | null; analysis: Analysis | null; mode: 'draw' | 'edit' | 'view'; layer: 'image' | 'zones' | 'values'; onGeometry: (g: Geometry) => void };
export default function FieldMap({ geometry, analysis, mode, layer, onGeometry }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const fieldSource = useRef(new VectorSource());
  const zoneSource = useRef(new VectorSource());
  const valueSource = useRef(new VectorSource());
  const zoneLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const valueLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const imageLayerRef = useRef<ImageLayer<ImageSource> | null>(null);
  const areaOverlay = useRef<Overlay | null>(null);
  const areaLabel = useRef<HTMLDivElement | null>(null);
  const draw = useRef<Draw | null>(null);
  const modify = useRef<Modify | null>(null);
  const callback = useRef(onGeometry);
  callback.current = onGeometry;

  useEffect(() => {
    if (!element.current) return;
    const fieldLayer = new VectorLayer({ source: fieldSource.current, style: new Style({
      stroke: new Stroke({ color: '#fefefe', width: 3 }), fill: new Fill({ color: 'rgba(39,73,53,.12)' })
    }) });
    const zoneLayer = new VectorLayer({ source: zoneSource.current, style: feature => {
      const c = Number(feature.get('class'));
      return new Style({ fill: new Fill({ color: `${colors[c] ?? '#999999'}a8` }), stroke: new Stroke({ color: colors[c] ?? '#777', width: 1 }) });
    } });
    const valueLayer = new VectorLayer({ source: valueSource.current, style: feature => {
      const ratio = Math.max(0, Math.min(1, Number(feature.get('ratio'))));
      const hue = Math.round(25 + ratio * 105);
      return new Style({ fill: new Fill({ color: `hsla(${hue},68%,49%,.77)` }), stroke: new Stroke({ color: `hsla(${hue},60%,35%,.3)`, width: .3 }) });
    } });
    const imageLayer = new ImageLayer({ opacity: .82 });
    zoneLayerRef.current = zoneLayer; valueLayerRef.current = valueLayer; imageLayerRef.current = imageLayer;
    const m = new Map({ target: element.current, layers: [
      new TileLayer({ source: new XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attributions: 'Imágenes © Esri, Maxar, Earthstar Geographics y GIS User Community', maxZoom: 19 }) }),
      imageLayer, valueLayer, zoneLayer, fieldLayer
    ], view: new View({ center: fromLonLat([-63.5, -33]), zoom: 5, maxZoom: 20 }) });
    const label = document.createElement('div');
    label.className = 'field-area-label';
    Object.assign(label.style, {
      background: '#183c2ee6', border: '1px solid #fff', color: '#fff', padding: '7px 10px', borderRadius: '7px',
      fontSize: '12px', fontWeight: '800', boxShadow: '0 2px 9px #0004', whiteSpace: 'nowrap', pointerEvents: 'none'
    });
    const overlay = new Overlay({ element: label, positioning: 'center-center', stopEvent: false });
    m.addOverlay(overlay);
    areaLabel.current = label;
    areaOverlay.current = overlay;
    map.current = m;
    return () => { m.setTarget(undefined); map.current = null; areaOverlay.current = null; areaLabel.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (draw.current) { m.removeInteraction(draw.current); draw.current = null; }
    if (modify.current) { m.removeInteraction(modify.current); modify.current = null; }
    const source = fieldSource.current;
    if (mode === 'draw') {
      const interaction = new Draw({ source, type: 'Polygon' });
      interaction.on('drawstart', () => source.clear());
      interaction.on('drawend', event => {
        const feature = new GeoJSON().writeFeatureObject(event.feature, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
        callback.current(feature.geometry as Geometry);
      });
      m.addInteraction(interaction); draw.current = interaction;
    } else if (mode === 'edit') {
      const interaction = new Modify({ source });
      interaction.on('modifyend', event => {
        const feature = event.features.item(0);
        if (feature) callback.current(new GeoJSON().writeFeatureObject(feature, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }).geometry as Geometry);
      });
      m.addInteraction(interaction); modify.current = interaction;
    }
  }, [mode]);

  useEffect(() => {
    const source = fieldSource.current;
    source.clear();
    if (!geometry) {
      areaOverlay.current?.setPosition(undefined);
      return;
    }
    const parsed = new GeoJSON().readFeature({ type: 'Feature', geometry, properties: {} }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    const feature = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!feature) return;
    const hectares = area({ type: 'Feature', properties: {}, geometry }) / 10000;
    const exceedsLimit = hectares > 50;
    source.addFeature(feature);
    const geometryOnMap = feature.getGeometry() as Polygon | undefined;
    const position = geometryOnMap?.getInteriorPoint().getCoordinates();
    const label = areaLabel.current;
    if (label && position) {
      label.textContent = `${hectares.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ha${exceedsLimit ? ' · Límite excedido' : ''}`;
      label.style.background = exceedsLimit ? '#a63b31ee' : '#183c2ee6';
      areaOverlay.current?.setPosition(position);
    }
    map.current?.getView().fit(feature.getGeometry()!.getExtent(), { padding: [50, 50, 50, 50], maxZoom: 17, duration: 250 });
  }, [geometry]);

  useEffect(() => {
    const source = zoneSource.current;
    source.clear();
    valueSource.current.clear();
    if (!analysis) {
      imageLayerRef.current?.setSource(null);
      return;
    }
    source.addFeatures(new GeoJSON().readFeatures(analysis.zones, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    const valid = analysis.cells.filter(c => c.value !== null);
    const min = Math.min(...valid.map(c => c.value!));
    const max = Math.max(...valid.map(c => c.value!));
    const valueFeatures = valid.map(c => ({ type: 'Feature', geometry: c.geometry, properties: { ratio: max > min ? (c.value! - min) / (max - min) : .5 } }));
    valueSource.current.addFeatures(new GeoJSON().readFeatures({ type: 'FeatureCollection', features: valueFeatures }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    if (analysis.preview) {
      imageLayerRef.current?.setSource(new ImageStatic({
        url: analysis.preview.dataUrl,
        projection: 'EPSG:3857',
        imageExtent: transformExtent(analysis.preview.extentWgs84, 'EPSG:4326', 'EPSG:3857'),
      }));
    } else {
      imageLayerRef.current?.setSource(null);
    }
  }, [analysis]);

  useEffect(() => {
    imageLayerRef.current?.setVisible(layer === 'image' && !!analysis?.preview);
    zoneLayerRef.current?.setVisible(layer === 'zones');
    valueLayerRef.current?.setVisible(layer === 'values');
  }, [analysis?.preview, layer]);

  return <div ref={element} className="map" aria-label="Mapa satelital para dibujar un lote" />;
}
