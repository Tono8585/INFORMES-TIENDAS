'use client';

import { useState, useEffect } from 'react';
import { deserializeReport, ResumenTab, ParrillaTab } from './lib/reportLogic';

export default function Home() {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState('resumen');

  useEffect(() => {
    fetch('/data.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('No hay informe publicado');
        return res.json();
      })
      .then((obj) => {
        const parsed = deserializeReport(obj);
        if (!parsed) {
          setStatus('empty');
        } else {
          setReport(parsed);
          setStatus('ready');
        }
      })
      .catch(() => setStatus('empty'));
  }, []);

  return (
    <main className="wrap">
      <header className="header">
        <h1>Informe Stock Tiendas-T3</h1>
        <p>Distribución, cobertura y disponibilidad de modelos WOMAN-T3</p>
      </header>

      {status === 'loading' && (
        <section className="card"><p>Cargando informe…</p></section>
      )}

      {status === 'empty' && (
        <section className="card">
          <h2>Todavía no hay ningún informe publicado</h2>
          <p className="desc">
            La persona encargada de generarlo tiene que subir los ficheros de datos desde el panel de
            administración y publicar el resultado. Vuelve a intentarlo en un rato.
          </p>
        </section>
      )}

      {status === 'ready' && report && (
        <>
          <p className="footnote" style={{ margin: '10px 32px 0' }}>
            Informe generado el {new Date(report.generatedAt).toLocaleString('es-ES')}
          </p>
          <nav className="tab-nav">
            <button className={`tab-btn ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setTab('resumen')}>📊 Resumen</button>
            <button className={`tab-btn ${tab === 'parrilla' ? 'active' : ''}`} onClick={() => setTab('parrilla')}>🖼️ Parrilla de Modelos</button>
          </nav>
          {tab === 'resumen' && <ResumenTab dataset={report.dataset} kpis={report.kpis} />}
          {tab === 'parrilla' && <ParrillaTab dataset={report.dataset} />}
        </>
      )}
    </main>
  );
}
