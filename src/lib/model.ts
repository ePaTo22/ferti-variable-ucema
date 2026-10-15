import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature as GeoFeature, Polygon as GeoPolygon, MultiPolygon as GeoMultiPolygon } from 'geojson';

export type Geometry = { type: 'Polygon'; coordinates: number[][][] };
export type Feature = { type: 'Feature'; geometry: GeoJSONGeometry; properties: { class: number } };
export type GeoJSONGeometry = { type: string; coordinates: unknown };
export type Scene = { id: string; date: string; cloud: number | null; assets: { blue: string; green: string; red: string; nir: string; scl: string } };
export type ImagePreview = { dataUrl: string; extentWgs84: [number, number, number, number] };
export type Cell = { row: number; col: number; lon: number; lat: number; value: number | null; class: number; areaHa: number; geometry: GeoJSONGeometry };
export type Analysis = {
  source: 'satellite' | 'geotiff' | 'csv'; areaHa: number; validAreaHa: number;
  classAreaHa: number[]; thresholds: number[]; cells: Cell[];
  zones: { type: 'FeatureCollection'; features: Feature[] };
  preview?: ImagePreview | null;
};
export type SoilPin = { id: string; lon: number; lat: number; class: number; createdAt: string };
export type SoilUnit = '%' | 'ppm';
export type SoilParameter = { id: string; name: string; value: number; unit: SoilUnit };
export type SoilSample = {
  id: string; class: number; createdAt: string; sampledAt: string; depthCm: number; lab: string;
  ph: number | null; parameters: SoilParameter[]; notes: string;
  pins: { lon: number; lat: number }[];
};
export type Project = {
  id: string; name: string; createdAt: string; geometry: Geometry | null;
  crop: 'Maíz' | 'Trigo'; fertilizer: string; nPercent: number;
  baseDose: number; direction: 'high' | 'low'; doses: number[];
  analysis: Analysis | null; scene: Scene | null;
  sourceFileName: string | null; confirmed: boolean;
  pins: SoilPin[]; soilSamples: SoilSample[];
};

export function newProject(): Project {
  return { id: crypto.randomUUID(), name: 'Nuevo lote', createdAt: new Date().toISOString(), geometry: null,
    crop: 'Maíz', fertilizer: 'Urea', nPercent: 46, baseDose: 100, direction: 'high',
    doses: [80, 100, 120],
    analysis: null, scene: null, sourceFileName: null, confirmed: false,
    pins: [], soilSamples: [] };
}
type LegacySoilSample = SoilSample & Partial<{
  organicMatter: number | null; nitrogenPpm: number | null; phosphorusPpm: number | null; potassiumPpm: number | null;
}>;
// Las muestras guardadas antes de los parámetros dinámicos tenían MO/N/P/K como campos fijos en ppm o %.
function normalizeSoilSample(sample: LegacySoilSample): SoilSample {
  if (sample.parameters) return sample;
  const legacy: [string, number | null | undefined, SoilUnit][] = [
    ['Materia orgánica', sample.organicMatter, '%'],
    ['N-NO3', sample.nitrogenPpm, 'ppm'],
    ['P Bray', sample.phosphorusPpm, 'ppm'],
    ['K', sample.potassiumPpm, 'ppm'],
  ];
  const parameters = legacy.filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value, unit]) => ({ id: crypto.randomUUID(), name, value: value as number, unit }));
  return { ...sample, parameters };
}
// Los proyectos guardados antes de esta función no tienen `pins`/`soilSamples`.
export function normalizeProject(project: Project): Project {
  return { ...project, pins: project.pins ?? [], soilSamples: (project.soilSamples ?? []).map(normalizeSoilSample) };
}
export const classNames = ['Bajo', 'Medio', 'Alto'];
export const colors = ['#e6a04a', '#d2c65a', '#548e50'];
export const SAMPLE_SIZE = 4;

export function zoneForPoint(zones: Analysis['zones'], lon: number, lat: number): number | null {
  const pt = point([lon, lat]);
  for (const feature of zones.features) {
    const polygon = feature as unknown as GeoFeature<GeoPolygon | GeoMultiPolygon>;
    if (booleanPointInPolygon(pt, polygon)) return feature.properties.class;
  }
  return null;
}

export function groupPinsByZone(pins: SoilPin[]): SoilPin[][] {
  const groups: SoilPin[][] = classNames.map(() => []);
  for (const pin of pins) groups[pin.class]?.push(pin);
  return groups;
}

export function proposedDoses(base: number, direction: 'high' | 'low'): number[] {
  const multipliers = direction === 'high' ? [0.8, 1, 1.2] : [1.2, 1, 0.8];
  return multipliers.map(m => Math.round(base * m * 10) / 10);
}

export function fertilizerSummary(project: Project) {
  const areas = project.analysis?.classAreaHa ?? [0, 0, 0];
  return areas.map((areaHa, i) => ({ areaHa, dose: project.doses[i], productKg: areaHa * project.doses[i], nitrogenKg: areaHa * project.doses[i] * project.nPercent / 100 }));
}
