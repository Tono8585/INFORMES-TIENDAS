'use client';

import { useState, useRef, useCallback } from 'react';
import {
  fmt, parseXlsxFile, processCsvStreaming, finalizeDataset,
  serializeReport, ResumenTab, ParrillaTab,
} from '../lib/reportLogic';

export default function AdminPage() {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [dataset, setDataset] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [tab, setTab] = useState('resumen');
  const [progress, setProgress] = useState(0);
  const [published, setPublished] = useState(false);

  const csvInputRef = useRef(null);
  const xlsxInputRef = useRef(null);
  const [csvFile, setCsvFile] = useState(null);
  const [xlsxFile, setXlsxFile] = useState(null);

  const handleProcess = useCallback(async () => {
    if (!csvFile || !xlsxFile) return;
    setStatus('loading');
    setErrorMsg('');
    setProgress(0);
    setPublished(false);
    try {
      const xlsxData = await parseXlsxFile(xlsxFile);
      const raw = await processCsvStreaming(csvFile, xlsxData.tempDest, (n) => setProgress(n));
      const built = finalizeDataset(raw, xlsxData.mcExtra);
      setDataset(built);
      setKpis(xlsxData.kpis);
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, [csvFile, xlsxFile]);

  const handleDownloadReport = useCallback(() => {
    if (!dataset || !kpis) return;
    const payload = serializeReport(dataset, kpis);
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    a.click();
    URL.revokeObjectURL(url);
    setPublished(true);
  }, [dataset, kpis]);

  return (
    <main className="wrap">
      <header className="header">
        <h1>Informe Stock Tiendas-T3 — Panel de administración</h1>
        <p>Esta página es solo para generar y publicar el informe. La gente con quien compartas la URL principal (/) no ve esta pantalla.</p>
      </header>

      {status !== 'ready' && (
        <section className="card upload-card">
          <h2>1. Sube los ficheros de datos</h2>
          <div className="upload-row">
            <label>
              CSV unificado (mc_vivos_en_tienda)
              <input ref={csvInputRef} type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} />
            </label>
            <label>
              Excel Inf. Distribución T2+T3 WOMAN
              <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls" onChange={(e) => setXlsxFile(e.target.files[0])} />
            </label>
          </div>
          <button className="btn-primary" disabled={!csvFile || !xlsxFile || status === 'loading'} onClick={handleProcess}>
            {status === 'loading' ? 'Procesando…' : 'Generar informe'}
          </button>
          {status === 'loading' && progress > 0 && <p className="footnote">{fmt(progress)} filas procesadas…</p>}
          {status === 'error' && <p className="error-text">Error: {errorMsg}</p>}
          <p className="footnote">
            Todo el procesamiento ocurre en tu navegador — los ficheros no se suben a ningún servidor.
            Con CSVs grandes (100-200MB) puede tardar uno o dos minutos.
          </p>
        </section>
      )}

      {status === 'ready' && dataset && (
        <>
          <section className="card">
            <h2>2. Revisa el informe</h2>
            <div className="desc">Comprueba que los datos son correctos antes de publicarlos para todo el mundo.</div>
            <nav className="tab-nav" style={{ margin: '0 0 14px', borderRadius: 8, padding: '0 8px' }}>
              <button className={`tab-btn ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setTab('resumen')}>📊 Resumen</button>
              <button className={`tab-btn ${tab === 'parrilla' ? 'active' : ''}`} onClick={() => setTab('parrilla')}>🖼️ Parrilla de Modelos</button>
              <button className="tab-btn" onClick={() => setStatus('idle')}>🔄 Cargar otros ficheros</button>
            </nav>
          </section>
          {tab === 'resumen' && <ResumenTab dataset={dataset} kpis={kpis} />}
          {tab === 'parrilla' && <ParrillaTab dataset={dataset} />}

          <section className="card">
            <h2>3. Publica el informe</h2>
            <div className="desc">
              Descarga el fichero <code>data.json</code> con los datos ya procesados, y súbelo a tu
              repositorio de GitHub en la carpeta <code>public/</code> (reemplazando el que ya hay).
              Vercel volverá a desplegar automáticamente en 1-2 minutos, y a partir de ahí cualquiera que
              entre a la URL principal verá este informe actualizado — sin tener que subir nada.
            </div>
            <button className="btn-primary" onClick={handleDownloadReport}>⬇ Descargar data.json</button>
            {published && (
              <p className="footnote" style={{ marginTop: 10 }}>
                ✅ Descargado. Ahora ve a tu repositorio en GitHub → carpeta <code>public</code> → archivo{' '}
                <code>data.json</code> → botón de editar/subir → reemplázalo por este nuevo archivo → Commit.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
