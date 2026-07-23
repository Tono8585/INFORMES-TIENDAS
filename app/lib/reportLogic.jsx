'use client';

import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------
export function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const rounded = Math.round(n);
  const neg = rounded < 0;
  const s = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + s;
}
export function fmt1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const fixed = n.toFixed(1);
  const neg = fixed.startsWith('-');
  const abs = neg ? fixed.slice(1) : fixed;
  const [intPart, decPart] = abs.split('.');
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + intGrouped + ',' + decPart;
}

export const PAIS_ISO = {
  ALEMANIA: 'DE', ANDORRA: 'AD', 'ARABIA SAUDI': 'SA', AUSTRIA: 'AT', BAHREIN: 'BH',
  BELGICA: 'BE', BULGARIA: 'BG', CEUTA: 'ES', 'CHIPRE NORTE': 'CY', COLOMBIA: 'CO',
  'COREA DEL SUR': 'KR', CROACIA: 'HR', DINAMARCA: 'DK', 'EMIRATOS ARABES UNIDOS': 'AE',
  ESLOVAQUIA: 'SK', ESLOVENIA: 'SI', ESPAÑA: 'ES', FINLANDIA: 'FI', FRANCIA: 'FR',
  GEORGIA: 'GE', GIBRALTAR: 'GI', GRECIA: 'GR', GUADALUPE: 'GP', 'HONG KONG': 'HK',
  HUNGRIA: 'HU', IRLANDA: 'IE', 'ISLAS CANARIAS': 'ES', ITALIA: 'IT', KUWAIT: 'KW',
  LIBANO: 'LB', LUXEMBURGO: 'LU', MALASIA: 'MY', MARTINICA: 'MQ', MELILLA: 'ES',
  MEXICO: 'MX', MOLDEVIA: 'MD', MONGOLIA: 'MN', NORUEGA: 'NO', OMAN: 'OM',
  'PAISES BAJOS': 'NL', POLONIA: 'PL', PORTUGAL: 'PT', QATAR: 'QA', 'REINO UNIDO': 'GB',
  'REPUBLICA CHECA': 'CZ', RUMANIA: 'RO', SINGAPUR: 'SG', SUECIA: 'SE', SUIZA: 'CH',
  TAILANDIA: 'TH', TURQUIA: 'TR', 'U.S.A.': 'US', UCRANIA: 'UA',
};
export function FlagImg({ pais }) {
  const code = PAIS_ISO[pais];
  if (!code) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/24x18/${code.toLowerCase()}.png`}
      width={20}
      height={15}
      alt={code}
      style={{ verticalAlign: 'middle', marginRight: 6, borderRadius: 2, boxShadow: '0 0 0 1px rgba(0,0,0,.08)' }}
    />
  );
}

// ---------------------------------------------------------------
// Parseo de ficheros
// ---------------------------------------------------------------
// (el parseo del CSV se hace en streaming, ver processCsvStreaming más abajo)

export async function parseXlsxFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets['Detalle MC'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const tempDest = {};
  const mcExtra = {};
  const hoy = new Date();
  let vig = 0;
  let novig = 0;
  let stockTiendaTotal = 0;
  let ventaTotal = 0;
  let stockAlmTotal = 0;

  // NOTA: SheetJS no reserva la columna A vacía que sí incluye openpyxl (Python),
  // así que aquí los índices van desplazados -1 respecto al pipeline en Python:
  // Temp Dest=3, MC Base=4, Descripción=5, Phase-in=11, Phase-out=12,
  // Venta Bruta L7D (total)=16, Stock total=19, Stock Almacén=20,
  // Unidades Entradas=58, Unidades Compradas=59.
  for (let i = 6; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const mc = row[4];
    if (mc === null || mc === undefined) continue;
    const tempDestVal = row[3];
    tempDest[mc] = tempDestVal;
    const stockAlm = typeof row[20] === 'number' ? row[20] : 0;
    const entradas = typeof row[58] === 'number' ? row[58] : 0;
    const compradas = typeof row[59] === 'number' ? row[59] : 0;
    mcExtra[mc] = { stockAlm, entradas, compradas };

    if (tempDestVal !== 'T3') continue;
    const stockTotal = typeof row[19] === 'number' ? row[19] : 0;
    if (stockTotal <= 3) continue;
    const pi = row[11];
    const po = row[12];
    const esVigente = pi instanceof Date && po instanceof Date && pi <= hoy && hoy <= po;
    if (esVigente) vig++; else novig++;
    stockTiendaTotal += stockTotal;
    ventaTotal += typeof row[16] === 'number' ? row[16] : 0;
    stockAlmTotal += stockAlm;
  }

  const kpis = {
    mcVigente: vig, mcNoVigente: novig,
    stockTiendaTotal, ventaTotal, stockAlmTotal,
  };
  return { tempDest, mcExtra, kpis };
}

// ---------------------------------------------------------------
// Construcción del catálogo (equivalente al pipeline pandas)
// ---------------------------------------------------------------
export function processCsvStreaming(file, tempDest, onRowCount) {
  return new Promise((resolve, reject) => {
    const tiendasMap = new Map();
    const mcAgg = new Map();
    const storeGroups = new Map(); // store -> Map(mc -> {stock, venta})
    const storeBlockedSets = new Map(); // store -> Set(mc)
    let rowCount = 0;

    Papa.parse(file, {
      header: true,
      worker: true,
      skipEmptyLines: true,
      chunk: (results) => {
        for (const r of results.data) {
          rowCount++;
          if (!r.cod_mc_base) continue;
          if (tempDest[r.cod_mc_base] !== 'T3') continue;
          const stock = Number(r.stock_mc_tienda_ayer) || 0;
          if (stock <= 3) continue;
          const venta = Number(r.venta_mc_tienda_7d) || 0;
          const codTienda = String(r.cod_tienda);

          if (!tiendasMap.has(codTienda)) {
            tiendasMap.set(codTienda, {
              cod_tienda: codTienda, des_tienda: r.des_tienda, rango_tienda: r.rango_tienda,
              des_canal: r.des_canal, pais: r.des_pais_facturacion,
            });
          }

          if (!mcAgg.has(r.cod_mc_base)) {
            mcAgg.set(r.cod_mc_base, {
              cod_mc_base: r.cod_mc_base, descripcion_modelo: r.descripcion_modelo, familia: r.familia,
              purchasing_group: r.purchasing_group, tematica: r.tematica || '', phase_in: r.phase_in,
              phase_out: r.phase_out, vigencia: r.vigencia, stores: new Set(), stockTienda: 0, venta: 0,
              stockLlica: Number(r.stock_llica_mc_ayer) || 0, pctTallas: Number(r.pct_tallas_200u_mc_ayer) || 0,
              numPlantasBloqueadas: Number(r.num_plantas_bloqueadas) || 0,
            });
          }
          const m = mcAgg.get(r.cod_mc_base);
          m.stores.add(codTienda);
          m.stockTienda += stock;
          m.venta += venta;

          if (!storeGroups.has(codTienda)) storeGroups.set(codTienda, new Map());
          const g = storeGroups.get(codTienda);
          if (!g.has(r.cod_mc_base)) g.set(r.cod_mc_base, { stock: 0, venta: 0 });
          const e = g.get(r.cod_mc_base);
          e.stock += stock; e.venta += venta;

          if (String(r.is_bloqueado).toLowerCase() === 'true') {
            if (!storeBlockedSets.has(codTienda)) storeBlockedSets.set(codTienda, new Set());
            storeBlockedSets.get(codTienda).add(r.cod_mc_base);
          }
        }
        if (onRowCount) onRowCount(rowCount);
      },
      complete: () => resolve({ tiendasMap, mcAgg, storeGroups, storeBlockedSets }),
      error: reject,
    });
  });
}

export function finalizeDataset({ tiendasMap, mcAgg, storeGroups, storeBlockedSets }, mcExtra) {
  const tiendasCatalog = Array.from(tiendasMap.values()).sort((a, b) => a.cod_tienda.localeCompare(b.cod_tienda));

  const mcCatalog = [];
  const mcIndex = new Map();
  Array.from(mcAgg.values()).forEach((m, idx) => {
    const nTiendas = m.stores.size;
    const pctBloqueadas = (m.numPlantasBloqueadas / Math.max(nTiendas, 1)) * 100;
    const blockedAgg = pctBloqueadas > 50;
    const extra = mcExtra[m.cod_mc_base] || { stockAlm: 0, entradas: 0, compradas: 0 };
    const pctCe = extra.compradas > 0 ? ((extra.compradas - extra.entradas) / extra.compradas) * 100 : 0;
    let disponibilidad;
    if (extra.stockAlm > 1000 && m.pctTallas > 50) disponibilidad = 'In Stock';
    else if (pctCe > 10) disponibilidad = 'Coming Soon';
    else disponibilidad = 'Sold Out';
    const cobertura = m.venta > 0 ? Math.round((m.stockTienda / m.venta) * 10) / 10 : null;

    mcCatalog.push({
      cod_mc_base: m.cod_mc_base, descripcion_modelo: m.descripcion_modelo,
      familia: m.familia, purchasing_group: m.purchasing_group, tematica: m.tematica,
      phase_in: m.phase_in, phase_out: m.phase_out, vigencia: m.vigencia,
      n_tiendas: nTiendas, stock_tienda: m.stockTienda, venta_7d: m.venta,
      stock_alm: extra.stockAlm, pct_tallas_200u: m.pctTallas,
      pct_tiendas_bloqueadas: Math.round(pctBloqueadas * 10) / 10, blocked_agg: blockedAgg,
      disponibilidad, cobertura,
    });
    mcIndex.set(m.cod_mc_base, idx);
  });

  const storeMcData = new Map();
  storeGroups.forEach((g, store) => {
    const idx = []; const stock = []; const venta = [];
    g.forEach((v, mc) => {
      if (!mcIndex.has(mc)) return;
      idx.push(mcIndex.get(mc)); stock.push(v.stock); venta.push(v.venta);
    });
    storeMcData.set(store, { idx, stock, venta });
  });

  const storeBlockedIdx = new Map();
  storeBlockedSets.forEach((set, store) => {
    const idxSet = new Set();
    set.forEach((mc) => { if (mcIndex.has(mc)) idxSet.add(mcIndex.get(mc)); });
    storeBlockedIdx.set(store, idxSet);
  });

  return { tiendasCatalog, mcCatalog, storeMcData, storeBlockedIdx, mcIndex };
}

// ---------------------------------------------------------------
// Cálculo de fichas por tienda (reutilizado en Tabla 1 y Parrilla)
// ---------------------------------------------------------------
function computeStoreRow(storeCode, familia, phaseIn, top100, storeMcData, mcCatalog, storeBlockedIdx) {
  const sd = storeMcData.get(storeCode);
  if (!sd) return { mc_vigente: 0, mc_no_vigente: 0, mc_total: 0, stock_tienda: 0, venta_7d: 0, cobertura: null, mc_blocked: 0, top100_soldout: 0 };
  const blkSet = storeBlockedIdx.get(storeCode) || new Set();
  let vig = 0; let novig = 0; let stock = 0; let venta = 0; let blocked = 0; let top100SoldOut = 0;
  for (let i = 0; i < sd.idx.length; i++) {
    const idx = sd.idx[i];
    const mc = mcCatalog[idx];
    if (familia && mc.familia !== familia) continue;
    if (phaseIn && mc.phase_in !== phaseIn) continue;
    if (mc.vigencia === 'vigente') vig++; else novig++;
    stock += sd.stock[i];
    venta += sd.venta[i];
    if (blkSet.has(idx)) blocked++;
    if (top100 && top100.has(idx) && mc.disponibilidad === 'Sold Out') top100SoldOut++;
  }
  return {
    mc_vigente: vig, mc_no_vigente: novig, mc_total: vig + novig,
    stock_tienda: stock, venta_7d: venta,
    cobertura: venta > 0 ? Math.round((stock / venta) * 10) / 10 : null,
    mc_blocked: blocked, top100_soldout: top100SoldOut,
  };
}

function computeTop100ForStore(storeCode, storeMcData) {
  const sd = storeMcData.get(storeCode);
  if (!sd) return new Set();
  const arr = sd.idx.map((idx, i) => ({ idx, venta: sd.venta[i] }));
  arr.sort((a, b) => b.venta - a.venta);
  return new Set(arr.slice(0, 100).map((o) => o.idx));
}
function computeTop100ForStores(storesList, storeMcData) {
  const ventaAccum = new Map();
  storesList.forEach((store) => {
    const sd = storeMcData.get(store);
    if (!sd) return;
    for (let i = 0; i < sd.idx.length; i++) {
      const idx = sd.idx[i];
      ventaAccum.set(idx, (ventaAccum.get(idx) || 0) + sd.venta[i]);
    }
  });
  const arr = Array.from(ventaAccum.entries()).map(([idx, venta]) => ({ idx, venta }));
  arr.sort((a, b) => b.venta - a.venta);
  return new Set(arr.slice(0, 100).map((o) => o.idx));
}

// ---------------------------------------------------------------
// Serialización del dataset ya procesado (para publicar/leer data.json)
// ---------------------------------------------------------------
export function serializeReport(dataset, kpis) {
  const storeMcDataObj = {};
  dataset.storeMcData.forEach((v, k) => { storeMcDataObj[k] = v; });
  const storeBlockedIdxObj = {};
  dataset.storeBlockedIdx.forEach((v, k) => { storeBlockedIdxObj[k] = Array.from(v); });
  return {
    generatedAt: new Date().toISOString(),
    kpis,
    tiendasCatalog: dataset.tiendasCatalog,
    mcCatalog: dataset.mcCatalog,
    storeMcData: storeMcDataObj,
    storeBlockedIdx: storeBlockedIdxObj,
  };
}

export function deserializeReport(obj) {
  if (!obj || !obj.kpis) return null;
  const storeMcData = new Map(Object.entries(obj.storeMcData));
  const storeBlockedIdx = new Map(Object.entries(obj.storeBlockedIdx).map(([k, v]) => [k, new Set(v)]));
  return {
    kpis: obj.kpis,
    generatedAt: obj.generatedAt,
    dataset: {
      tiendasCatalog: obj.tiendasCatalog,
      mcCatalog: obj.mcCatalog,
      storeMcData,
      storeBlockedIdx,
    },
  };
}

// =================================================================
// COMPONENTE PRINCIPAL
// =================================================================

export function ResumenTab({ dataset, kpis }) {
  const { tiendasCatalog, mcCatalog, storeMcData, storeBlockedIdx } = dataset;

  const rangos = useMemo(() => Array.from(new Set(tiendasCatalog.map((t) => t.rango_tienda))).sort(), [tiendasCatalog]);
  const familias = useMemo(() => Array.from(new Set(mcCatalog.map((m) => m.familia))).sort(), [mcCatalog]);
  const phaseIns = useMemo(
    () => Array.from(new Set(mcCatalog.map((m) => m.phase_in))).sort((a, b) => {
      const da = a.split('/').reverse().join('-');
      const db = b.split('/').reverse().join('-');
      return da.localeCompare(db);
    }),
    [mcCatalog],
  );
  const paises = useMemo(() => Array.from(new Set(tiendasCatalog.map((t) => t.pais))).sort(), [tiendasCatalog]);
  const purchasingGroups = useMemo(() => Array.from(new Set(mcCatalog.map((m) => m.purchasing_group))).sort(), [mcCatalog]);

  // ---- Tabla 1: País ----
  const [t1Rango, setT1Rango] = useState('');
  const [t1Familia, setT1Familia] = useState('');
  const [t1PhaseIn, setT1PhaseIn] = useState('');
  const [t1Mercado, setT1Mercado] = useState('');
  const [t1Tienda, setT1Tienda] = useState('');
  const [t1ExcludeOnline, setT1ExcludeOnline] = useState(false);

  const findTienda = (val) => {
    if (!val) return null;
    const code = val.split(' - ')[0].trim();
    return tiendasCatalog.find((t) => t.cod_tienda === code)
      || tiendasCatalog.find((t) => t.des_tienda.toLowerCase().includes(val.toLowerCase()))
      || null;
  };

  const tabla1 = useMemo(() => {
    let rows = [];
    let info = '';
    if (t1Tienda) {
      const tObj = findTienda(t1Tienda);
      if (tObj) {
        const top100 = computeTop100ForStore(tObj.cod_tienda, storeMcData);
        const r = computeStoreRow(tObj.cod_tienda, t1Familia, t1PhaseIn, top100, storeMcData, mcCatalog, storeBlockedIdx);
        rows = [{ ...r, label: `${tObj.cod_tienda} - ${tObj.des_tienda}`, pais: tObj.pais }];
        info = `Datos EXACTOS de la tienda ${tObj.cod_tienda} · ${tObj.des_tienda} · País ${tObj.pais}.`;
      } else info = 'Tienda no encontrada.';
    } else if (t1Mercado) {
      const stores = tiendasCatalog.filter((t) => t.pais === t1Mercado && (!t1Rango || t.rango_tienda === t1Rango) && (!t1ExcludeOnline || t.rango_tienda !== 'Online'));
      const top100 = computeTop100ForStores(stores.map((t) => t.cod_tienda), storeMcData);
      rows = stores.map((t) => ({ ...computeStoreRow(t.cod_tienda, t1Familia, t1PhaseIn, top100, storeMcData, mcCatalog, storeBlockedIdx), label: `${t.cod_tienda} - ${t.des_tienda}`, pais: t.pais }));
      info = `Desglose de ${t1Mercado} (${stores.length} tiendas).`;
    } else {
      const relevant = tiendasCatalog.filter((t) => (!t1Rango || t.rango_tienda === t1Rango) && (!t1ExcludeOnline || t.rango_tienda !== 'Online'));
      const byPais = new Map();
      relevant.forEach((t) => {
        if (!byPais.has(t.pais)) byPais.set(t.pais, []);
        byPais.get(t.pais).push(t.cod_tienda);
      });
      rows = Array.from(byPais.entries()).map(([pais, stores]) => {
        const present = new Set();
        const accum = new Map();
        stores.forEach((store) => {
          const sd = storeMcData.get(store);
          if (!sd) return;
          const blkSet = storeBlockedIdx.get(store) || new Set();
          for (let i = 0; i < sd.idx.length; i++) {
            const idx = sd.idx[i];
            const mc = mcCatalog[idx];
            if (t1Familia && mc.familia !== t1Familia) continue;
            if (t1PhaseIn && mc.phase_in !== t1PhaseIn) continue;
            present.add(idx);
            if (!accum.has(idx)) accum.set(idx, { stock: 0, venta: 0, storesConMc: 0, storesBloqueadas: 0 });
            const a = accum.get(idx);
            a.stock += sd.stock[i]; a.venta += sd.venta[i]; a.storesConMc += 1;
            if (blkSet.has(idx)) a.storesBloqueadas += 1;
          }
        });
        const ranked = Array.from(present).map((idx) => ({ idx, venta: accum.get(idx).venta }));
        ranked.sort((a, b) => b.venta - a.venta);
        const top100 = new Set(ranked.slice(0, 100).map((o) => o.idx));
        let vig = 0; let novig = 0; let stock = 0; let venta = 0; let blocked = 0; let top100SoldOut = 0;
        present.forEach((idx) => {
          const mc = mcCatalog[idx];
          const a = accum.get(idx);
          if (mc.vigencia === 'vigente') vig++; else novig++;
          stock += a.stock; venta += a.venta;
          if (a.storesBloqueadas / a.storesConMc > 0.5) blocked++;
          if (top100.has(idx) && mc.disponibilidad === 'Sold Out') top100SoldOut++;
        });
        return {
          label: pais, pais, mc_vigente: vig, mc_no_vigente: novig, mc_total: vig + novig,
          stock_tienda: stock, venta_7d: venta,
          cobertura: venta > 0 ? Math.round((stock / venta) * 10) / 10 : null,
          mc_blocked: blocked, top100_soldout: top100SoldOut,
        };
      });
      info = t1PhaseIn ? `Filtrado por Phase-in ${t1PhaseIn}.` : '';
    }
    rows.sort((a, b) => b.mc_total - a.mc_total);
    return { rows, info };
  }, [t1Rango, t1Familia, t1PhaseIn, t1Mercado, t1Tienda, t1ExcludeOnline, tiendasCatalog, mcCatalog, storeMcData, storeBlockedIdx]);

  // ---- Tabla 2: PG x Familia ----
  const [t2Rango, setT2Rango] = useState('');
  const [t2Pg, setT2Pg] = useState('');
  const [t2Familia, setT2Familia] = useState('');
  const [t2PhaseIn, setT2PhaseIn] = useState('');
  const [t2Tienda, setT2Tienda] = useState('');
  const [t2ExcludeOnline, setT2ExcludeOnline] = useState(false);

  const tabla2 = useMemo(() => {
    let rows = [];
    let info = '';
    const buildRow = (g) => ({
      ...g,
      n_mc_total: g.n_mc_vigente + g.n_mc_no_vigente,
      cobertura: g.venta_7d > 0 ? Math.round((g.stock_tienda / g.venta_7d) * 10) / 10 : null,
    });

    if (t2Tienda) {
      const tObj = findTienda(t2Tienda);
      if (tObj) {
        const sd = storeMcData.get(tObj.cod_tienda);
        const blkSet = storeBlockedIdx.get(tObj.cod_tienda) || new Set();
        const groups = new Map();
        if (sd) {
          for (let i = 0; i < sd.idx.length; i++) {
            const idx = sd.idx[i];
            const mc = mcCatalog[idx];
            if (t2PhaseIn && mc.phase_in !== t2PhaseIn) continue;
            const key = `${mc.purchasing_group}|${mc.familia}`;
            if (!groups.has(key)) groups.set(key, { purchasing_group: mc.purchasing_group, familia: mc.familia, n_mc_vigente: 0, n_mc_no_vigente: 0, stock_tienda: 0, venta_7d: 0, stock_alm: 0, mc_blocked: 0 });
            const g = groups.get(key);
            if (mc.vigencia === 'vigente') g.n_mc_vigente++; else g.n_mc_no_vigente++;
            g.stock_tienda += sd.stock[i]; g.venta_7d += sd.venta[i]; g.stock_alm += mc.stock_alm;
            if (blkSet.has(idx)) g.mc_blocked++;
          }
        }
        rows = Array.from(groups.values()).map(buildRow);
        info = `Datos EXACTOS de ${tObj.cod_tienda} · ${tObj.des_tienda}.`;
      } else info = 'Tienda no encontrada.';
      rows = rows.filter((r) => (!t2Pg || r.purchasing_group === t2Pg) && (!t2Familia || r.familia === t2Familia));
    } else {
      const stores = tiendasCatalog.filter((t) => (!t2Rango || t.rango_tienda === t2Rango) && (!t2ExcludeOnline || t.rango_tienda !== 'Online')).map((t) => t.cod_tienda);
      const present = new Set();
      const accum = new Map();
      stores.forEach((store) => {
        const sd = storeMcData.get(store);
        if (!sd) return;
        for (let i = 0; i < sd.idx.length; i++) {
          const idx = sd.idx[i];
          const mc = mcCatalog[idx];
          if (t2PhaseIn && mc.phase_in !== t2PhaseIn) continue;
          present.add(idx);
          if (!accum.has(idx)) accum.set(idx, { stock: 0, venta: 0 });
          const a = accum.get(idx);
          a.stock += sd.stock[i]; a.venta += sd.venta[i];
        }
      });
      const groups = new Map();
      present.forEach((idx) => {
        const mc = mcCatalog[idx];
        const a = accum.get(idx);
        const key = `${mc.purchasing_group}|${mc.familia}`;
        if (!groups.has(key)) groups.set(key, { purchasing_group: mc.purchasing_group, familia: mc.familia, n_mc_vigente: 0, n_mc_no_vigente: 0, stock_tienda: 0, venta_7d: 0, stock_alm: 0, mc_blocked: 0 });
        const g = groups.get(key);
        if (mc.vigencia === 'vigente') g.n_mc_vigente++; else g.n_mc_no_vigente++;
        g.stock_tienda += a.stock; g.venta_7d += a.venta; g.stock_alm += mc.stock_alm;
        if (mc.blocked_agg) g.mc_blocked++;
      });
      rows = Array.from(groups.values()).map(buildRow);
      rows = rows.filter((r) => (!t2Pg || r.purchasing_group === t2Pg) && (!t2Familia || r.familia === t2Familia));
      info = [t2PhaseIn ? `Phase-in ${t2PhaseIn}.` : '', t2ExcludeOnline ? 'Online excluido.' : ''].filter(Boolean).join(' ');
    }
    rows.sort((a, b) => b.stock_tienda - a.stock_tienda);
    return { rows, info };
  }, [t2Rango, t2Pg, t2Familia, t2PhaseIn, t2Tienda, t2ExcludeOnline, tiendasCatalog, mcCatalog, storeMcData, storeBlockedIdx]);

  return (
    <>
      {kpis && (
        <div className="kpis">
          <div className="kpi"><div className="label">MC Vigentes</div><div className="value">{fmt(kpis.mcVigente)}</div></div>
          <div className="kpi"><div className="label">MC Caducos</div><div className="value">{fmt(kpis.mcNoVigente)}</div></div>
          <div className="kpi"><div className="label">Stock Tienda (Uds)</div><div className="value">{fmt(kpis.stockTiendaTotal)}</div></div>
          <div className="kpi"><div className="label">Venta 7D (Uds)</div><div className="value">{fmt(kpis.ventaTotal)}</div></div>
          <div className="kpi"><div className="label">Stock Almacén</div><div className="value">{fmt(kpis.stockAlmTotal)}</div></div>
        </div>
      )}

      <div className="card">
        <h2>1. Nº Modelos Color por País — Vigentes vs Caducos</h2>
        <div className="desc">Sólo T3. Si eliges un Mercado se desglosa por tienda; si eliges una tienda concreta, datos exactos.</div>
        <div className="filters">
          <select value={t1Rango} onChange={(e) => setT1Rango(e.target.value)}><option value="">Todos los rangos</option>{rangos.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select value={t1Familia} onChange={(e) => setT1Familia(e.target.value)}><option value="">Todas las familias</option>{familias.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          <select value={t1PhaseIn} onChange={(e) => setT1PhaseIn(e.target.value)}><option value="">Todos los Phase-in</option>{phaseIns.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select value={t1Mercado} onChange={(e) => setT1Mercado(e.target.value)}><option value="">Todos los mercados</option>{paises.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <input list="tiendas-list" placeholder="Código o nombre de tienda" value={t1Tienda} onChange={(e) => setT1Tienda(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={t1ExcludeOnline} onChange={(e) => setT1ExcludeOnline(e.target.checked)} /> Excluir Online</label>
          <button className="clear-btn" onClick={() => { setT1Rango(''); setT1Familia(''); setT1PhaseIn(''); setT1Mercado(''); setT1Tienda(''); setT1ExcludeOnline(false); }}>Limpiar Filtros</button>
        </div>
        <div className="desc">{tabla1.info}</div>
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th>País / Tienda</th><th>MC Vigentes</th><th>MC Caducos</th><th>% Caducos</th><th>MC Total</th>
              <th>Stock Tienda</th><th>Venta 7D</th><th>Cobertura (Sem.)</th><th>MC Blocked</th><th>Nº MC Sold Out Top 100</th>
            </tr></thead>
            <tbody>
              {tabla1.rows.map((r, i) => {
                const pct = r.mc_total > 0 ? (r.mc_no_vigente / r.mc_total) * 100 : 0;
                return (
                  <tr key={i}>
                    <td><FlagImg pais={r.pais} />{r.label}</td>
                    <td>{fmt(r.mc_vigente)}</td><td>{fmt(r.mc_no_vigente)}</td>
                    <td><span className="granate">{fmt1(pct)}%</span></td><td>{fmt(r.mc_total)}</td>
                    <td>{fmt(r.stock_tienda)}</td><td>{fmt(r.venta_7d)}</td>
                    <td className="cobertura-col">{fmt1(r.cobertura)}</td>
                    <td>{r.mc_blocked > 0 ? <span className="badge blocked">{fmt(r.mc_blocked)}</span> : fmt(r.mc_blocked)}</td>
                    <td>{r.top100_soldout > 0 ? <span className="badge soldout">{fmt(r.top100_soldout)}</span> : fmt(r.top100_soldout)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>2. Nº Modelos, Stock, Venta, Cobertura y Blocked por Purchasing Group y Familia</h2>
        <div className="filters">
          <select value={t2Rango} onChange={(e) => setT2Rango(e.target.value)}><option value="">Todos los rangos</option>{rangos.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select value={t2Pg} onChange={(e) => setT2Pg(e.target.value)}><option value="">Todos los PG</option>{purchasingGroups.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select value={t2Familia} onChange={(e) => setT2Familia(e.target.value)}><option value="">Todas las familias</option>{familias.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          <select value={t2PhaseIn} onChange={(e) => setT2PhaseIn(e.target.value)}><option value="">Todos los Phase-in</option>{phaseIns.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <input list="tiendas-list" placeholder="Código o nombre de tienda" value={t2Tienda} onChange={(e) => setT2Tienda(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={t2ExcludeOnline} onChange={(e) => setT2ExcludeOnline(e.target.checked)} /> Excluir Online</label>
          <button className="clear-btn" onClick={() => { setT2Rango(''); setT2Pg(''); setT2Familia(''); setT2PhaseIn(''); setT2Tienda(''); setT2ExcludeOnline(false); }}>Limpiar Filtros</button>
        </div>
        <div className="desc">{tabla2.info}</div>
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th>Purchasing Group</th><th>Familia</th><th>MC Vigentes</th><th>MC Caducados</th><th>MC Total</th>
              <th>Stock Tienda</th><th>Venta 7D</th><th>Stock Almacén</th><th>Cobertura (Sem.)</th><th>MC Blocked</th>
            </tr></thead>
            <tbody>
              {tabla2.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.purchasing_group}</td><td>{r.familia}</td>
                  <td>{fmt(r.n_mc_vigente)}</td><td>{fmt(r.n_mc_no_vigente)}</td><td>{fmt(r.n_mc_total)}</td>
                  <td>{fmt(r.stock_tienda)}</td><td>{fmt(r.venta_7d)}</td><td>{fmt(r.stock_alm)}</td>
                  <td className="cobertura-col">{fmt1(r.cobertura)}</td>
                  <td>{r.mc_blocked > 0 ? <span className="badge blocked">{fmt(r.mc_blocked)}</span> : fmt(r.mc_blocked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="tiendas-list">
        {tiendasCatalog.slice(0, 3000).map((t) => <option key={t.cod_tienda} value={`${t.cod_tienda} - ${t.des_tienda}`} />)}
      </datalist>
    </>
  );
}

// =================================================================
// PESTAÑA PARRILLA DE MODELOS
// =================================================================
export function ParrillaTab({ dataset }) {
  const { tiendasCatalog, mcCatalog, storeMcData, storeBlockedIdx } = dataset;

  const purchasingGroups = useMemo(() => Array.from(new Set(mcCatalog.map((m) => m.purchasing_group))).sort(), [mcCatalog]);
  const familias = useMemo(() => Array.from(new Set(mcCatalog.map((m) => m.familia))).sort(), [mcCatalog]);
  const phaseIns = useMemo(
    () => Array.from(new Set(mcCatalog.map((m) => m.phase_in))).sort((a, b) => {
      const da = a.split('/').reverse().join('-');
      const db = b.split('/').reverse().join('-');
      return da.localeCompare(db);
    }),
    [mcCatalog],
  );

  const [pg, setPg] = useState('');
  const [familia, setFamilia] = useState('');
  const [vigencia, setVigencia] = useState('');
  const [disp, setDisp] = useState('');
  const [phaseIn, setPhaseIn] = useState('');
  const [tienda, setTienda] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [desc, setDesc] = useState('');

  const findTienda = (val) => {
    if (!val) return null;
    const code = val.split(' - ')[0].trim();
    return tiendasCatalog.find((t) => t.cod_tienda === code)
      || tiendasCatalog.find((t) => t.des_tienda.toLowerCase().includes(val.toLowerCase()))
      || null;
  };

  const rows = useMemo(() => {
    let base = mcCatalog;
    let storeMap = null;
    let tObj = null;
    if (tienda) {
      tObj = findTienda(tienda);
      if (tObj) {
        const sd = storeMcData.get(tObj.cod_tienda);
        storeMap = new Map();
        if (sd) sd.idx.forEach((idx, i) => storeMap.set(idx, { stock: sd.stock[i], venta: sd.venta[i] }));
      } else {
        storeMap = new Map();
      }
    }
    const blkSet = tObj ? (storeBlockedIdx.get(tObj.cod_tienda) || new Set()) : null;

    let out = base.map((r, idx) => {
      const sInfo = storeMap ? storeMap.get(idx) : null;
      const stock = storeMap ? (sInfo ? sInfo.stock : null) : r.stock_tienda;
      const venta = storeMap ? (sInfo ? sInfo.venta : null) : r.venta_7d;
      const cobertura = venta > 0 ? Math.round((stock / venta) * 10) / 10 : null;
      const blocked = blkSet ? blkSet.has(idx) : r.blocked_agg;
      return { ...r, idx, __presente: storeMap ? !!sInfo : true, __stock: stock, __venta: venta, __cobertura: cobertura, __blocked: blocked };
    });

    if (storeMap) out = out.filter((r) => r.__presente);
    if (pg) out = out.filter((r) => r.purchasing_group === pg);
    if (familia) out = out.filter((r) => r.familia === familia);
    if (vigencia) out = out.filter((r) => r.vigencia === (vigencia === 'Vigente' ? 'vigente' : 'no vigente'));
    if (disp) out = out.filter((r) => r.disponibilidad === disp);
    if (phaseIn) out = out.filter((r) => r.phase_in === phaseIn);
    if (blockedOnly) out = out.filter((r) => r.__blocked);
    if (desc) {
      const q = desc.toLowerCase();
      out = out.filter((r) => r.descripcion_modelo.toLowerCase().includes(q) || r.cod_mc_base.toLowerCase().includes(q));
    }
    out.sort((a, b) => (b.__venta || 0) - (a.__venta || 0));
    return out;
  }, [mcCatalog, storeMcData, storeBlockedIdx, tiendasCatalog, pg, familia, vigencia, disp, phaseIn, tienda, blockedOnly, desc]);

  const badgeClass = { 'In Stock': 'instock', 'Sold Out': 'soldout', 'Coming Soon': 'comingsoon' };
  const MAX = 60;

  return (
    <div className="card">
      <div className="filters">
        <select value={pg} onChange={(e) => setPg(e.target.value)}><option value="">Todos los PG</option>{purchasingGroups.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select value={familia} onChange={(e) => setFamilia(e.target.value)}><option value="">Todas las familias</option>{familias.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        <select value={vigencia} onChange={(e) => setVigencia(e.target.value)}><option value="">Todos</option><option value="Vigente">Vigente</option><option value="Caduco">Caduco</option></select>
        <select value={disp} onChange={(e) => setDisp(e.target.value)}><option value="">Toda disponibilidad</option><option value="In Stock">In Stock</option><option value="Sold Out">Sold Out</option><option value="Coming Soon">Coming Soon</option></select>
        <select value={phaseIn} onChange={(e) => setPhaseIn(e.target.value)}><option value="">Todos los Phase-in</option>{phaseIns.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <input list="tiendas-list-parrilla" placeholder="Código o nombre de tienda" value={tienda} onChange={(e) => setTienda(e.target.value)} />
        <input placeholder="Descripción o código MC" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> Solo Blocked</label>
      </div>
      <datalist id="tiendas-list-parrilla">
        {tiendasCatalog.slice(0, 3000).map((t) => <option key={t.cod_tienda} value={`${t.cod_tienda} - ${t.des_tienda}`} />)}
      </datalist>

      <p className="results-count" style={{ margin: '0 0 10px' }}>{fmt(rows.length)} modelo(s) encontrados</p>

      <div className="grid">
        {rows.slice(0, MAX).map((r) => (
          <div className="pcard" key={r.cod_mc_base}>
            <div className="card-img">
              {r.familia}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="photo" src={`https://media.mango.com/is/image/punto/${r.cod_mc_base}-001?wid=400`} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none'; }} />
              <span className={`badge ${badgeClass[r.disponibilidad]}`}>{r.disponibilidad}</span>
              {r.__blocked && <span className="badge blocked">Blocked</span>}
            </div>
            <div className="card-body">
              <div className="card-title">{r.descripcion_modelo?.trim()}</div>
              <div className="card-mc">{r.cod_mc_base} · {r.vigencia === 'vigente' ? 'Vigente' : 'Caduco'}</div>
              <div className="card-meta">
                <b>PG:</b> {r.purchasing_group}{r.tematica ? ` · Temática: ${r.tematica}` : ''}<br />
                <b>Phase-in/out:</b> {r.phase_in} → {r.phase_out}<br />
                <b>Stock tienda:</b> {fmt(r.__stock)} · <b>Venta 7D:</b> {fmt(r.__venta)}<br />
                <b>Cobertura:</b> {r.__cobertura !== null ? `${fmt1(r.__cobertura)} sem.` : '-'}
              </div>
            </div>
          </div>
        ))}
      </div>
      {rows.length > MAX && <p className="footnote" style={{ margin: '0 32px' }}>Mostrando los primeros {MAX} de {fmt(rows.length)} resultados. Afina los filtros para ver más.</p>}
    </div>
  );
}
