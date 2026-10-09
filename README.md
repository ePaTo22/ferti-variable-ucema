# Ferti · demo de prescripción variable

Aplicación local para lotes de hasta 50 ha. Permite dibujar el lote, usar NDVI de una escena Sentinel-2 L2A o un mapa de rendimiento georreferenciado, generar tres ambientes y revisar una dosis variable de N para maíz o trigo.

## Ejecutar

Requiere Node.js 20.9+ y Python 3.11+.

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r worker/requirements.txt
```

En dos terminales:

```bash
.venv/bin/uvicorn worker.app:app --host 127.0.0.1 --port 8001
```

```bash
npm run dev -- --hostname 127.0.0.1
```

Abrir `http://127.0.0.1:3000`. Para otro host del servicio geoespacial, configurar `WORKER_URL` en el proceso de Next.js. El servicio es temporal: procesa cada solicitud en memoria o en un archivo temporal y no conserva las cargas.

## Uso

1. Dibujar un polígono válido de hasta 50 ha.
2. Seleccionar una imagen Sentinel-2 o cargar un GeoTIFF/CSV de hasta 25 MB. El GeoTIFF debe tener una banda y CRS. El CSV debe tener `lon`, `lat`, `rendimiento` (o `x`, `y`, `yield`); indicar su EPSG y elegir kg/ha o t/ha.
3. Generar ambientes. El procesador recorta al lote, trabaja sobre una grilla de 20 m y separa los valores válidos por terciles. Los píxeles sin datos quedan sin dosis. En Sentinel-2 calcula `(B08-B04)/(B08+B04)`, acepta clases SCL de vegetación y suelo desnudo, y genera una previsualización RGB de la imagen usada sobre el lote.
4. Indicar fertilizante, porcentaje de N y dosis base en kg de producto/ha. Elegir la dirección del ajuste. Las dosis propuestas son 80 %, 100 % y 120 % de la base, editables.
5. Confirmar las dosis y exportar GeoJSON de polígonos con dosis, CSV de celdas válidas o imprimir el mapa en PDF.

La aplicación guarda los proyectos y archivos en IndexedDB del navegador. Si se borran los datos del sitio o se usa otro dispositivo, no se recuperan. Para la siguiente etapa, el tipo `Project` y los resultados `Analysis` permiten separar proyectos, archivos y análisis en PostgreSQL/PostGIS y Supabase Storage.

## Verificación

```bash
npm run lint
npm test
npm run build
PYTHONPATH=worker .venv/bin/python -m unittest worker.test_app -v
```

Las pruebas del servicio cubren límite de área, CSV, GeoTIFF con reproyección y rechazo de TIFF sin CRS. Las de TypeScript cubren inversión de dosis y exportaciones. Para comprobar en QGIS, abrir el GeoJSON exportado y comparar superficie y ubicación con el lote original; abrir el CSV como puntos WGS84 y verificar que quedan dentro del polígono.

## Límites de la demo

- Requiere conexión para Earth Search, los COG Sentinel-2 y el mapa satelital.
- La cobertura de nubes del catálogo corresponde a la escena; el porcentaje válido dentro del lote se muestra después de procesarla.
- Los CSV de rendimiento se agregan por celda; las celdas sin puntos no se interpolan y quedan sin prescripción.
- La exportación es genérica y no se ha adaptado a una consola de fertilización concreta.
