import io
import json
import tempfile
import unittest

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import Polygon, mapping

from app import app, field_setup, satellite_preview


CLIENT = TestClient(app)
TO_WGS = Transformer.from_crs("EPSG:32720", "EPSG:4326", always_xy=True).transform
X, Y = 400000, 6500000


def square(side_m=100):
    points = [(X, Y), (X + side_m, Y), (X + side_m, Y + side_m), (X, Y + side_m), (X, Y)]
    return mapping(Polygon([TO_WGS(x, y) for x, y in points]))


def triangle():
    points = [(X + 3, Y + 7), (X + 113, Y + 24), (X + 28, Y + 118), (X + 3, Y + 7)]
    return mapping(Polygon([TO_WGS(x, y) for x, y in points]))


class WorkerTests(unittest.TestCase):
    def test_field_limit(self):
        with self.assertRaises(Exception):
            field_setup(json.dumps(square(710)))

    def test_csv_three_classes(self):
        points = [(X + 15, Y + 15, 1000), (X + 45, Y + 45, 3000), (X + 75, Y + 75, 5000)]
        text = 'lon,lat,rendimiento\n' + ''.join(f'{TO_WGS(x,y)[0]},{TO_WGS(x,y)[1]},{value}\n' for x, y, value in points)
        response = CLIENT.post('/process', data={'geometry': json.dumps(square()), 'source': 'csv', 'unit': 'kg/ha'}, files={'file': ('yield.csv', text.encode(), 'text/csv')})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual({c['class'] for c in data['cells'] if c['class'] >= 0}, {0, 1, 2})
        self.assertEqual(len(data['zones']['features']), 3)
        self.assertGreater(data['areaHa'], data['validAreaHa'])

    def test_projected_csv_coordinates(self):
        text = 'x,y,yield\n' + ''.join(f'{X+d},{Y+d},{value}\n' for d, value in [(15, 1), (45, 3), (75, 5)])
        response = CLIENT.post('/process', data={'geometry': json.dumps(square()), 'source': 'csv', 'unit': 't/ha', 'csv_crs': 'EPSG:32720'}, files={'file': ('yield.csv', text.encode(), 'text/csv')})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual({c['value'] for c in response.json()['cells'] if c['value'] is not None}, {1000, 3000, 5000})

    def test_geotiff_reproject_and_nodata(self):
        with tempfile.NamedTemporaryFile(suffix='.tif') as temporary:
            values = np.tile(np.linspace(1, 100, 20, dtype='float32'), (20, 1))
            values[:, :2] = -9999
            with rasterio.open(temporary.name, 'w', driver='GTiff', height=20, width=20, count=1,
                               dtype='float32', crs='EPSG:32720', transform=from_origin(X, Y + 100, 5, 5), nodata=-9999) as dst:
                dst.write(values, 1)
            with open(temporary.name, 'rb') as stream:
                response = CLIENT.post('/process', data={'geometry': json.dumps(square()), 'source': 'geotiff'}, files={'file': ('yield.tif', stream, 'image/tiff')})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['source'], 'geotiff')
        self.assertGreater(len(data['cells']), 0)
        self.assertTrue(all(c['geometry']['type'] in ('Polygon', 'MultiPolygon') for c in data['cells']))

    def test_partial_edge_cells_cover_the_full_field(self):
        with tempfile.NamedTemporaryFile(suffix='.tif') as temporary:
            values = np.tile(np.linspace(1, 100, 30, dtype='float32'), (30, 1))
            with rasterio.open(temporary.name, 'w', driver='GTiff', height=30, width=30, count=1,
                               dtype='float32', crs='EPSG:32720', transform=from_origin(X, Y + 150, 5, 5)) as dst:
                dst.write(values, 1)
            with open(temporary.name, 'rb') as stream:
                response = CLIENT.post('/process', data={'geometry': json.dumps(triangle()), 'source': 'geotiff'}, files={'file': ('yield.tif', stream, 'image/tiff')})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertAlmostEqual(data['validAreaHa'], data['areaHa'], places=3)

    def test_no_crs_rejected(self):
        with tempfile.NamedTemporaryFile(suffix='.tif') as temporary:
            with rasterio.open(temporary.name, 'w', driver='GTiff', height=20, width=20, count=1,
                               dtype='float32', transform=from_origin(X, Y + 100, 5, 5)) as dst:
                dst.write(np.ones((20, 20), dtype='float32'), 1)
            with open(temporary.name, 'rb') as stream:
                response = CLIENT.post('/process', data={'geometry': json.dumps(square()), 'source': 'geotiff'}, files={'file': ('bad.tif', stream, 'image/tiff')})
        self.assertEqual(response.status_code, 400)
        self.assertIn('CRS', response.json()['detail'])

    def test_satellite_preview_creates_transparent_png(self):
        raster = np.array([[100, 200], [300, 400]], dtype='float32')
        preview = satellite_preview(raster, raster, raster, np.array([[4, 5], [4, 9]], dtype='uint8'),
                                    np.ones((2, 2), dtype=bool), TO_WGS, from_origin(X, Y + 40, 20, 20))
        self.assertIsNotNone(preview)
        self.assertTrue(preview['dataUrl'].startswith('data:image/png;base64,'))
        self.assertEqual(len(preview['extentWgs84']), 4)


if __name__ == '__main__':
    unittest.main()
