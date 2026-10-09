import type { Project } from './model';
import { classNames } from './model';

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function prescriptionGeoJSON(project: Project): string {
  if (!project.analysis || !project.confirmed) throw new Error('Confirmá la prescripción antes de exportar.');
  return JSON.stringify({ type: 'FeatureCollection', features: project.analysis.zones.features.map(f => ({
    ...f, properties: { ambiente: classNames[f.properties.class], clase: f.properties.class,
      cultivo: project.crop, fertilizante: project.fertilizer, porcentaje_n: project.nPercent,
      dosis_producto_kg_ha: project.doses[f.properties.class], fuente: project.analysis?.source }
  })) }, null, 2);
}
export function prescriptionCSV(project: Project): string {
  if (!project.analysis || !project.confirmed) throw new Error('Confirmá la prescripción antes de exportar.');
  const header = 'lat,lon,ambiente,valor_fuente,area_ha,dosis_producto_kg_ha,producto_kg,n_kg';
  const rows = project.analysis.cells.filter(c => c.class >= 0).map(c => {
    const dose = project.doses[c.class];
    return [c.lat, c.lon, classNames[c.class], c.value, c.areaHa, dose,
      (c.areaHa * dose).toFixed(3), (c.areaHa * dose * project.nPercent / 100).toFixed(3)].join(',');
  });
  return [header, ...rows].join('\n');
}
