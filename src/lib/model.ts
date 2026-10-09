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
export type Project = {
  id: string; name: string; createdAt: string; geometry: Geometry | null;
  crop: 'Maíz' | 'Trigo'; fertilizer: string; nPercent: number;
  baseDose: number; direction: 'high' | 'low'; doses: number[];
  analysis: Analysis | null; scene: Scene | null;
  sourceFileName: string | null; confirmed: boolean;
};

export function newProject(): Project {
  return { id: crypto.randomUUID(), name: 'Nuevo lote', createdAt: new Date().toISOString(), geometry: null,
    crop: 'Maíz', fertilizer: 'Urea', nPercent: 46, baseDose: 100, direction: 'high',
    doses: [80, 100, 120],
    analysis: null, scene: null, sourceFileName: null, confirmed: false };
}
export const classNames = ['Bajo', 'Medio', 'Alto'];
export const colors = ['#e6a04a', '#d2c65a', '#548e50'];

export function proposedDoses(base: number, direction: 'high' | 'low'): number[] {
  const multipliers = direction === 'high' ? [0.8, 1, 1.2] : [1.2, 1, 0.8];
  return multipliers.map(m => Math.round(base * m * 10) / 10);
}

export function fertilizerSummary(project: Project) {
  const areas = project.analysis?.classAreaHa ?? [0, 0, 0];
  return areas.map((areaHa, i) => ({ areaHa, dose: project.doses[i], productKg: areaHa * project.doses[i], nitrogenKg: areaHa * project.doses[i] * project.nPercent / 100 }));
}
