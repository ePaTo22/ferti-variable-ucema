'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import area from '@turf/area';
import booleanValid from '@turf/boolean-valid';
import type { Analysis, Geometry, Project, Scene } from '@/lib/model';
import { classNames, colors, fertilizerSummary, newProject, proposedDoses } from '@/lib/model';
import { deleteProject, listProjects, loadFile, saveFile, saveProject } from '@/lib/storage';
import { download, prescriptionCSV, prescriptionGeoJSON } from '@/lib/download';

const FieldMap = dynamic(() => import('./FieldMap'), { ssr: false });
const num = (n: number, digits = 1) => n.toLocaleString('es-AR', { maximumFractionDigits: digits });
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
function responseError(body: { detail?: string }) { return body.detail || 'No se pudo completar la solicitud.'; }

export default function Workbench() {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<'draw' | 'edit' | 'view'>('view');
  const [mapLayer, setMapLayer] = useState<'image' | 'zones' | 'values'>('zones');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<'satellite' | 'geotiff' | 'csv'>('satellite');
  const [unit, setUnit] = useState<'kg/ha' | 't/ha'>('kg/ha');
  const [csvCrs, setCsvCrs] = useState('EPSG:4326');
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    listProjects().then(items => {
      const sorted = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setProjects(sorted); setProject(sorted[0] ?? newProject()); setReady(true);
    }).catch(err => { setError(`No se pudo abrir IndexedDB: ${errorText(err)}`); setProject(newProject()); setReady(true); });
  }, []);
  useEffect(() => {
    if (!ready || !project) return;
    const timer = setTimeout(() => {
      saveProject(project).then(() => listProjects()).then(setProjects).catch(err => setError(`No se pudo guardar: ${errorText(err)}`));
    }, 250);
    return () => clearTimeout(timer);
  }, [project, ready]);
  useEffect(() => {
    if (!project?.sourceFileName) { setFile(null); return; }
    loadFile(project.id).then(stored => setFile(stored ?? null)).catch(() => setFile(null));
  }, [project?.id, project?.sourceFileName]);

  const update = (patch: Partial<Project>, invalidate = false) => setProject(p => p ? { ...p, ...patch, ...(invalidate ? { confirmed: false } : {}) } : p);
  const onGeometry = useCallback((geometry: Geometry) => {
    const hectares = area({ type: 'Feature', properties: {}, geometry }) / 10000;
    if (!booleanValid({ type: 'Feature', properties: {}, geometry }) || !Number.isFinite(hectares) || hectares <= 0) {
      setError('El polígono no es válido. Editá sus vértices o dibujalo nuevamente.');
      setMode('edit');
      return;
    }
    setScenes([]);
    setProject(p => p ? { ...p, geometry, analysis: null, scene: null, confirmed: false } : p);
    if (hectares > 50) {
      setError(`El lote mide ${num(hectares, 2)} ha y supera el límite de 50 ha. Ajustá los vértices para continuar.`);
      setMode('edit');
      return;
    }
    setError(''); setScenes([]); setMode('view');
  }, []);

  async function searchScenes() {
    if (!project?.geometry) return;
    setBusy('Buscando escenas Sentinel-2…'); setError(''); setScenes([]);
    try {
      const response = await fetch('/api/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: project.geometry, dateFrom, dateTo }) });
      const body = await response.json(); if (!response.ok) throw new Error(responseError(body));
      setScenes(body.scenes); setMessage(`${body.scenes.length} imágenes disponibles.`);
    } catch (err) { setError(errorText(err)); } finally { setBusy(''); }
  }

  async function process() {
    if (!project?.geometry) return;
    if (source === 'satellite' && !project.scene) { setError('Elegí una imagen satelital.'); return; }
    if (source !== 'satellite' && !file) { setError('Elegí un archivo.'); return; }
    setBusy('Procesando la capa y delimitando ambientes…'); setError(''); setMessage('');
    try {
      const form = new FormData();
      form.set('geometry', JSON.stringify(project.geometry)); form.set('source', source); form.set('unit', unit); form.set('csv_crs', csvCrs);
      if (source === 'satellite') form.set('scene', JSON.stringify(project.scene));
      else if (file) form.set('file', file);
      const response = await fetch('/api/process', { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(responseError(body));
      const analysis = body as Analysis;
      update({ analysis, confirmed: false });
      setMapLayer(analysis.preview ? 'image' : 'zones');
      setMessage(`Procesado: ${num(analysis.validAreaHa, 2)} de ${num(analysis.areaHa, 2)} ha con datos válidos.`);
    } catch (err) { setError(errorText(err)); } finally { setBusy(''); }
  }

  function setBaseDose(value: number) {
    if (!project) return;
    update({ baseDose: value, doses: proposedDoses(value, project.direction) }, true);
  }
  function setDirection(value: 'high' | 'low') {
    if (!project) return;
    update({ direction: value, doses: proposedDoses(project.baseDose, value) }, true);
  }
  async function selectFile(selected: File | null) {
    if (!project || !selected) return;
    if (selected.size > 25 * 1024 * 1024) { setError('El archivo supera 25 MB.'); return; }
    const kind = selected.name.toLowerCase().endsWith('.csv') ? 'csv' : selected.name.toLowerCase().match(/\.tiff?$/) ? 'geotiff' : null;
    if (!kind) { setError('Usá un archivo .csv, .tif o .tiff.'); return; }
    try { await saveFile(project.id, selected); setFile(selected); setSource(kind); update({ sourceFileName: selected.name, analysis: null }, true); setError(''); }
    catch (err) { setError(`No se pudo guardar el archivo en el navegador: ${errorText(err)}`); }
  }
  async function removeCurrent() {
    if (!project || !window.confirm(`¿Eliminar “${project.name}” de este navegador?`)) return;
    await deleteProject(project.id); const items = await listProjects(); setProjects(items); setProject(items[0] ?? newProject()); setScenes([]);
  }
  function exportFile(kind: 'geojson' | 'csv') {
    if (!project) return;
    try {
      if (kind === 'geojson') download(`${project.name}-prescripcion.geojson`, prescriptionGeoJSON(project), 'application/geo+json');
      else download(`${project.name}-prescripcion.csv`, prescriptionCSV(project), 'text/csv;charset=utf-8');
    } catch (err) { setError(errorText(err)); }
  }

  if (!project) return <main className="loading">Cargando proyecto…</main>;
  const fieldHectares = project.geometry ? area({ type: 'Feature', properties: {}, geometry: project.geometry }) / 10000 : null;
  const fieldWithinLimit = fieldHectares !== null && fieldHectares > 0 && fieldHectares <= 50 && booleanValid({ type: 'Feature', properties: {}, geometry: project.geometry! });
  const summaries = fertilizerSummary(project);
  const canConfirm = !!project.analysis && project.doses.every(x => Number.isFinite(x) && x >= 0) && project.nPercent > 0 && project.nPercent <= 100 && project.fertilizer.trim() !== '';
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">F</div><div><strong>Ferti</strong><span>prescripción variable · demo</span></div></div><div className="top-note">Maíz y trigo · N por ambiente · hasta 50 ha</div></header>
    <main className="workspace">
      <aside className="sidebar">
        <section className="panel"><div className="eyebrow">Proyecto</div>
          <label>Nombre del lote<input value={project.name} onChange={e => update({ name: e.target.value })} /></label>
          <div className="field-row"><label>Cultivo<select value={project.crop} onChange={e => update({ crop: e.target.value as Project['crop'] }, true)}><option>Maíz</option><option>Trigo</option></select></label><label>Superficie<span className="static-field" style={fieldHectares && fieldHectares > 50 ? { color: '#ad4035', fontWeight: 800 } : undefined}>{fieldHectares !== null ? `${num(fieldHectares, 2)} ha` : 'Sin lote'}</span></label></div>
          <div className="actions"><button className="button subtle" onClick={() => { setProject(newProject()); setScenes([]); setFile(null); setMode('view'); }}>Nuevo proyecto</button><button className="button text-danger" onClick={removeCurrent}>Eliminar</button></div>
          {projects.length > 1 && <label>Proyectos guardados<select value={project.id} onChange={e => { setProject(projects.find(p => p.id === e.target.value) ?? project); setScenes([]); }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>}
        </section>
        <section className="panel"><div className="step-title"><span>01</span><div><h2>Delimitá el lote</h2><p>Dibujá el polígono sobre el mapa.</p></div></div>
          <div className="actions"><button className={`button ${mode === 'draw' ? 'active' : 'secondary'}`} onClick={() => setMode('draw')}>Dibujar</button><button className={`button ${mode === 'edit' ? 'active' : 'secondary'}`} disabled={!project.geometry} onClick={() => setMode('edit')}>Editar vértices</button><button className="button subtle" onClick={() => setMode('view')}>Terminar</button></div>
          <p className="hint">Doble clic para cerrar el polígono. El límite es 50 ha.</p>
        </section>
        <section className="panel"><div className="step-title"><span>02</span><div><h2>Seleccioná una imagen</h2><p>Imagen Sentinel-2 o mapa de rendimiento.</p></div></div>
          <div className="segmented"><button className={source === 'satellite' ? 'selected' : ''} onClick={() => setSource('satellite')}>Satélite</button><button className={source !== 'satellite' ? 'selected' : ''} onClick={() => setSource(file?.name.toLowerCase().endsWith('.csv') ? 'csv' : 'geotiff')}>Archivo</button></div>
          {source === 'satellite' ? <><div className="field-row"><label>Desde<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label>Hasta<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label></div>
            <button className="button secondary full" disabled={!fieldWithinLimit || !!busy} onClick={searchScenes}>Seleccionar imágenes</button>
            {scenes.length > 0 && <label>Imagen disponible<select value={project.scene?.id ?? ''} onChange={e => update({ scene: scenes.find(s => s.id === e.target.value) ?? null }, true)}><option value="">Seleccioná una imagen</option>{scenes.map(s => <option key={s.id} value={s.id}>{s.date.slice(0, 10)} · nube {num(s.cloud ?? 0, 0)}%</option>)}</select></label>}
            <p className="hint">Elegí una fecha apropiada para el estadio del cultivo. Al procesarla, se mostrará sobre el lote junto con los ambientes.</p></>
          : <><label className="upload">Subir GeoTIFF o CSV<input type="file" accept=".tif,.tiff,.csv" onChange={e => selectFile(e.target.files?.[0] ?? null)} /></label>{file && <p className="file-name">{file.name} · {num(file.size / 1048576, 1)} MB</p>}
            <label>Unidad de rendimiento<select value={unit} onChange={e => setUnit(e.target.value as typeof unit)}><option>kg/ha</option><option>t/ha</option></select></label>
            {source === 'csv' && <label>CRS del CSV (código EPSG)<input value={csvCrs} onChange={e => setCsvCrs(e.target.value)} placeholder="EPSG:4326" /></label>}
            <p className="hint">CSV: columnas lon/lat o x/y y rendimiento. Indicá el EPSG real. GeoTIFF: una banda numérica con CRS. Máximo 25 MB.</p></>}
          <button className="button primary full" disabled={!fieldWithinLimit || !!busy || (source === 'satellite' ? !project.scene : !file)} onClick={process}>{source === 'satellite' ? 'Ver imagen y generar ambientes' : 'Generar ambientes'}</button>
        </section>
        <section className="panel"><div className="step-title"><span>03</span><div><h2>Definí la dosis</h2><p>Propuesta editable por ambiente.</p></div></div>
          <div className="field-row"><label>Fertilizante<input value={project.fertilizer} onChange={e => update({ fertilizer: e.target.value }, true)} /></label><label>N en producto (%)<input type="number" min="0.1" max="100" value={project.nPercent} onChange={e => update({ nPercent: Number(e.target.value) }, true)} /></label></div>
          <label>Dosis base · kg de producto/ha<input type="number" min="0" step="0.1" value={project.baseDose} onChange={e => setBaseDose(Number(e.target.value))} /></label>
          <label>Relación con el valor de la capa<select value={project.direction} onChange={e => setDirection(e.target.value as Project['direction'])}><option value="high">Más N donde el valor es alto</option><option value="low">Más N donde el valor es bajo</option></select></label>
          <p className="hint">La propuesta parte de ±20 % de la dosis base. Revisá las tres dosis antes de confirmar.</p>
        </section>
      </aside>
      <section className="main-column">
        <div className="map-card"><div className="map-header"><div><div className="eyebrow">Vista del lote</div><h1>De la imagen a la dosis</h1></div><span className="map-status">{project.analysis ? `${num(project.analysis.validAreaHa, 2)} ha con datos` : project.geometry ? 'Lote definido' : 'Dibujá un lote'}</span></div>
          <FieldMap geometry={project.geometry} analysis={project.analysis} mode={mode} layer={mapLayer} onGeometry={onGeometry} />
          <div className="legend"><span><i style={{ background: '#ffffff', border: '1px solid #6b786b' }} /> Lote</span>{project.analysis && (mapLayer === 'zones' ? classNames.map((name, i) => <span key={name}><i style={{ background: colors[i] }} /> {name}</span>) : mapLayer === 'image' ? <span>Imagen Sentinel-2 usada para el análisis</span> : <span>Escala relativa de valores: naranja bajo · verde alto</span>)}</div>
          {project.analysis && <div className="map-toggle"><span>Ver capa</span>{project.analysis.preview && <button className={mapLayer === 'image' ? 'selected' : ''} onClick={() => setMapLayer('image')}>Imagen</button>}<button className={mapLayer === 'values' ? 'selected' : ''} onClick={() => setMapLayer('values')}>Valores de origen</button><button className={mapLayer === 'zones' ? 'selected' : ''} onClick={() => setMapLayer('zones')}>Ambientes</button></div>}
        </div>
        {busy && <div className="notice">{busy}</div>}{error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success">{message}</div>}
        <div className="results-head"><div><div className="eyebrow">Prescripción</div><h2>Tres ambientes, una decisión revisable</h2></div>{project.analysis && <span className="source-tag">{project.analysis.source === 'satellite' ? 'NDVI Sentinel-2' : 'Mapa de rendimiento'}</span>}</div>
        {project.analysis ? <><div className="zone-grid">{classNames.map((name, i) => <article className="zone-card" key={name} style={{ borderTopColor: colors[i] }}><div className="zone-header"><span className="zone-dot" style={{ background: colors[i] }} /><h3>{name}</h3><strong>{num(project.analysis!.classAreaHa[i], 2)} ha</strong></div>
          <label>Dosis · kg producto/ha<input type="number" min="0" step="0.1" value={project.doses[i]} onChange={e => update({ doses: project.doses.map((d, j) => j === i ? Number(e.target.value) : d) }, true)} /></label>
          <div className="zone-total"><span>Producto total</span><strong>{num(summaries[i].productKg, 1)} kg</strong></div><div className="zone-total"><span>N aportado</span><strong>{num(summaries[i].nitrogenKg, 1)} kg</strong></div>
        </article>)}</div>
          {project.analysis.validAreaHa < project.analysis.areaHa - 0.01 && <div className="notice caution">{num(project.analysis.areaHa - project.analysis.validAreaHa, 2)} ha sin datos válidos: no tienen dosis automática ni aparecen en el CSV de prescripción.</div>}
          <div className="export-panel"><div><h2>Revisar y exportar</h2><p>{project.confirmed ? 'Prescripción confirmada en este navegador.' : 'Confirmá las dosis antes de descargar la prescripción.'}</p></div><div className="actions"><button className="button primary" disabled={!canConfirm} onClick={() => update({ confirmed: true })}>{project.confirmed ? 'Confirmada' : 'Confirmar dosis'}</button><button className="button secondary" disabled={!project.confirmed} onClick={() => exportFile('geojson')}>GeoJSON</button><button className="button secondary" disabled={!project.confirmed} onClick={() => exportFile('csv')}>CSV</button><button className="button secondary" onClick={() => window.print()}>Mapa / PDF</button></div></div>
        </> : <div className="empty-state"><div className="empty-icon">⌁</div><h2>Prepará la primera prescripción</h2><p>Dibujá el lote, elegí una escena o subí un mapa de rendimiento y generá los tres ambientes.</p></div>}
      </section>
    </main><footer className="footer">Demo local · Los proyectos se guardan en este navegador. La dosis debe ser validada por un profesional según cultivo, estadio, análisis y condiciones del lote.</footer>
  </div>;
}
