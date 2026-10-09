import { describe, expect, it } from 'vitest';
import { newProject, proposedDoses } from './model';
import { prescriptionCSV, prescriptionGeoJSON } from './download';

describe('prescripción', () => {
  it('invierte las dosis sin cambiar la dosis media', () => {
    expect(proposedDoses(100, 'high')).toEqual([80, 100, 120]);
    expect(proposedDoses(100, 'low')).toEqual([120, 100, 80]);
  });
  it('exporta solo celdas válidas y dosis confirmadas', () => {
    const p = newProject();
    p.analysis = { source: 'csv', areaHa: 1, validAreaHa: .08, classAreaHa: [.04, .04, 0], thresholds: [1, 2],
      zones: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { class: 0 } }] },
      cells: [{ row: 0, col: 0, lat: -31, lon: -64, class: 0, value: 1, areaHa: .04, geometry: { type: 'Polygon', coordinates: [] } },
        { row: 0, col: 1, lat: -31, lon: -63, class: -1, value: null, areaHa: .04, geometry: { type: 'Polygon', coordinates: [] } }] };
    expect(() => prescriptionCSV(p)).toThrow('Confirmá');
    p.confirmed = true;
    expect(prescriptionCSV(p).split('\n')).toHaveLength(2);
    expect(JSON.parse(prescriptionGeoJSON(p)).features[0].properties.dosis_producto_kg_ha).toBe(80);
  });
});
