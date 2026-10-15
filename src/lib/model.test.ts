import { describe, expect, it } from 'vitest';
import { SAMPLE_SIZE, groupPinsByZone, newProject, proposedDoses, zoneForPoint } from './model';
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

describe('muestreo de suelo', () => {
  const zones = { type: 'FeatureCollection' as const, features: [
    { type: 'Feature' as const, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { class: 0 } },
    { type: 'Feature' as const, geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] }, properties: { class: 2 } },
  ] };
  it('asigna la clase de ambiente al punto, o null si cae afuera', () => {
    expect(zoneForPoint(zones, 0.5, 0.5)).toBe(0);
    expect(zoneForPoint(zones, 1.5, 0.5)).toBe(2);
    expect(zoneForPoint(zones, 5, 5)).toBeNull();
  });
  it('agrupa los pines por ambiente', () => {
    const pins = [0, 0, 1, 2].map((c, i) => ({ id: String(i), lon: 0, lat: 0, class: c, createdAt: String(i) }));
    const groups = groupPinsByZone(pins);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
    expect(groups[2]).toHaveLength(1);
  });
  it('requiere 4 submuestras por muestra compuesta', () => { expect(SAMPLE_SIZE).toBe(4); });
});
