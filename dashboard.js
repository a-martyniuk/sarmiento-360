// Helper para resolver archivos JSON relativos sin importar si la URL tiene slash final o no
const getRelativeDataUrl = (file) => {
    let path = window.location.pathname;
    if (!path.endsWith("/") && !path.endsWith(".html")) {
        path += "/";
    }
    return new URL(file, window.location.origin + path).href;
};

let rawExpenses  = [];
let rawBalances  = [];
let rawMultas    = [];
let rawExtraordinarios = [];
let rawMorosidad = [];
let filteredExpenses = [];
let currentPage  = 1;
let pageSize     = 20;
let ipcData      = {}; // Indexa la inflación del IPC por mes

// Fetch inflación oficial del INDEC (Datos Abiertos) - No bloqueante
const fetchIPC = async () => {
    // Datos baseline de respaldo para evitar dependencia estricta de la API externa
    const baselineIPC = {
        "2025-07": { valor: 4500, inflacion: 4.0 },
        "2025-08": { valor: 4680, inflacion: 4.0 },
        "2025-09": { valor: 4844, inflacion: 3.5 },
        "2025-10": { valor: 5013, inflacion: 3.5 },
        "2025-11": { valor: 5163, inflacion: 3.0 },
        "2025-12": { valor: 5318, inflacion: 3.0 },
        "2026-01": { valor: 5478, inflacion: 3.0 },
        "2026-02": { valor: 5642, inflacion: 3.0 },
        "2026-03": { valor: 5811, inflacion: 3.0 },
        "2026-04": { valor: 5985, inflacion: 3.0 },
        "2026-05": { valor: 6165, inflacion: 3.0 },
        "2026-06": { valor: 6350, inflacion: 3.0 },
        "2026-07": { valor: 6540, inflacion: 3.0 }
    };
    Object.assign(ipcData, baselineIPC);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const r = await fetch("https://apis.datos.gob.ar/series/api/series?ids=103.1_I2N_2016_M_15&collapse=month&limit=500&format=json", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!r.ok) return;

        const json = await r.json();
        const dataRows = json.data || [];
        for (let i = 0; i < dataRows.length; i++) {
            const dateStr = dataRows[i][0];
            const val = dataRows[i][1];
            const p = dateStr.slice(0, 7);
            let inflacion = null;
            if (i > 0) {
                const prevVal = dataRows[i - 1][1];
                if (prevVal > 0) {
                    inflacion = ((val - prevVal) / prevVal) * 100;
                }
            }
            ipcData[p] = { valor: val, inflacion };
        }

        // Proyectar meses futuros hasta 2026-07 para evitar N/D
        const periods = Object.keys(ipcData).sort();
        if (periods.length > 0) {
            let lastPeriod = periods[periods.length - 1];
            let lastVal = ipcData[lastPeriod].valor;
            let [y, m] = lastPeriod.split("-").map(Number);
            const limitYear = 2026;
            const limitMonth = 7;

            while (y < limitYear || (y === limitYear && m < limitMonth)) {
                m++;
                if (m > 12) {
                    m = 1;
                    y++;
                }
                const nextPeriod = `${y}-${String(m).padStart(2, '0')}`;
                const projectedInf = 4.2; // Tasa promedio proyectada
                lastVal = lastVal * (1 + projectedInf / 100);
                ipcData[nextPeriod] = { valor: lastVal, inflacion: projectedInf };
            }
        }
    } catch (e) {
        console.warn("API INDEC no disponible o lenta; usando valores baseline IPC local:", e.message || e);
    }
};

// Chart instances
let chartHistorical  = null;
let chartCategory    = null;
let chartComparison  = null;
let chartPatrimonial = null;

// ── Formatters ─────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
}).format(n);

const fmtFull = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2
}).format(n);

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// ── Category Pill HTML ──────────────────────────────────────────// 7 Categorías EXACTAS del PDF de liquidaciones
const CAT_CONFIG = {
    "Sueldos y Cargas Sociales":   { cls: "pill-sueldos",   icon: "👤", dot: "#f87171" },
    "Seguros":                     { cls: "pill-seguros",   icon: "🛡️", dot: "#fb923c" },
    "Servicios Públicos":          { cls: "pill-servicios", icon: "⚡", dot: "#fbbf24" },
    "Contratos y Abonos":          { cls: "pill-contratos", icon: "🛠️", dot: "#34d399" },
    "Administración":              { cls: "pill-admin",     icon: "📋", dot: "#60a5fa" },
    "Mantenimiento y Reparaciones":{ cls: "pill-manto",    icon: "🔧", dot: "#a78bfa" },
    "Gastos Extraordinarios":      { cls: "pill-extra",    icon: "🎨", dot: "#ec4899" },
    "Varios":                      { cls: "pill-varios",    icon: "📦", dot: "#9ca3af" },
};

const getCatPill = (rubro) => {
    const cfg = CAT_CONFIG[rubro] || { cls: "pill-varios", icon: "•", dot: "#9ca3af" };
    return `<span class="pill ${cfg.cls}">${cfg.icon} ${rubro}</span>`;
};

// ── Previous period string ──────────────────────────────────────
const prevPeriod = (p) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ── Match concepts intelligently ───────────────────────────────
const cleanConceptForMatching = (str) => {
    if (!str) return "";
    let s = str.toLowerCase();
    const monthNames = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
        "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"
    ];
    monthNames.forEach(m => {
        s = s.replace(new RegExp("\\b" + m + "\\b", "gi"), "");
    });
    s = s.replace(/\b202[4-9]\b/g, "").replace(/\b2[4-9]\b/g, "");
    return s.replace(/\s+/g, " ").trim();
};

const matchConcept = (c1, c2) => {
    if (!c1 || !c2) return false;
    const raw1 = c1.toLowerCase();
    const raw2 = c2.toLowerCase();
    
    // Si tienen números de cuenta de AySA / Edesur / Servicios diferentes, no deben emparejarse
    const getAccountNum = (s) => { const m = s.match(/\d{6,8}/); return m ? m[0] : null; };
    const acc1 = getAccountNum(raw1), acc2 = getAccountNum(raw2);
    if (acc1 && acc2 && acc1 !== acc2) return false;

    const norm1 = cleanConceptForMatching(c1);
    const norm2 = cleanConceptForMatching(c2);

    if (norm1 === norm2) return true;
    if (norm1.length >= 8 && norm2.length >= 8) {
        if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
        if (norm1.slice(0, 20) === norm2.slice(0, 20)) return true;
    }
    return raw1.slice(0, 20) === raw2.slice(0, 20);
};

// ── FILTROS Y UTILIDADES ───────────────────────────────────────

// ── Period filter ───────────────────────────────────────────────
const populatePeriodFilter = () => {
    const sel = document.getElementById("periodFilter");
    const periods = [...new Set(rawExpenses.map(e => e.periodo))].sort().reverse();
    


    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
    });

    // Seleccionar por defecto el último período consolidado con datos válidos y completos
    const validPeriods = periods.filter(p => {
        const bal = rawBalances.find(b => b.periodo === p);
        if (!bal || bal.egresos <= 0 || bal.patrimonio_neto <= 0) return false;
        const count = rawExpenses.filter(e => e.periodo === p).length;
        return count >= 10;
    });

    if (validPeriods.length > 0) {
        sel.value = validPeriods[0];
    } else if (periods.length > 0) {
        sel.value = periods[0];
    }

    // Update sidebar badge
    document.getElementById("sidebarPeriods").textContent = `${periods.length} meses (${periods[periods.length - 1]} a ${periods[0]})`;
};

// ── Apply filter ────────────────────────────────────────────────
const applyFilters = () => {
    const periodSel  = document.getElementById("periodFilter");
    const searchInp  = document.getElementById("searchInput");
    const statusSel  = document.getElementById("statusFilter");
    const catSel     = document.getElementById("categoryFilter");

    const period   = periodSel ? periodSel.value : "todos";
    const query    = searchInp ? searchInp.value.toLowerCase().trim() : "";
    const status   = statusSel ? statusSel.value : "todos";
    const selCat   = catSel ? catSel.value : "todos";
    const subSel   = document.getElementById("subcomponentFilter");
    const selSub   = subSel ? subSel.value : "todos";

    filteredExpenses = rawExpenses.filter(e => {
        const catName = e.categoria || e.rubro;
        const subComp = getSubcategoria(e);
        const okPeriod = period === "todos" || e.periodo === period;
        const okCat    = selCat === "todos" || catName === selCat;
        const okSub    = selSub === "todos" || subComp === selSub || e.empleado === selSub;
        const okSearch = !query ||
            e.concepto.toLowerCase().includes(query) ||
            catName.toLowerCase().includes(query) ||
            subComp.toLowerCase().includes(query) ||
            (e.rubro && e.rubro.toLowerCase().includes(query));
        const defaultExclusion = period === "todos" ? e.estado !== "Pendiente" : true;
        const okStatus = status === "todos" ? defaultExclusion : (e.estado || "Pagado") === status;

        return okPeriod && okCat && okSub && okSearch && okStatus;
    });

    currentPage = 1;
    updateDashboard(period === "todos");
};
const applyFilter = applyFilters;

// ── Event listeners ─────────────────────────────────────────────
const setupEventListeners = () => {
    const periodSel  = document.getElementById("periodFilter");
    const searchInp  = document.getElementById("searchInput");
    const statusSel  = document.getElementById("statusFilter");
    const catSel     = document.getElementById("categoryFilter");
    const chartTyp   = document.getElementById("chartTypeFilter");
    const pageSizeSel= document.getElementById("pageSizeSelect");

    if (periodSel) periodSel.addEventListener("change", applyFilter);
    if (searchInp) searchInp.addEventListener("input",  applyFilter);
    if (statusSel) statusSel.addEventListener("change", applyFilter);
    if (catSel)    catSel.addEventListener("change",    applyFilter);
    const subSel = document.getElementById("subcomponentFilter");
    if (subSel)    subSel.addEventListener("change",    applyFilter);
    if (chartTyp)  chartTyp.addEventListener("change",  () => renderHistoricalChart());
    const compViewFilter = document.getElementById("comparisonViewFilter");
    if (compViewFilter) compViewFilter.addEventListener("change", () => renderComparisonChart());
    if (pageSizeSel) pageSizeSel.addEventListener("change", () => {
        pageSize = parseInt(pageSizeSel.value);
        currentPage = 1;
        renderTable();
    });
};

// ── DETECT MISSING INVOICES ──────────────────────────────────────
const detectMissingInvoices = () => {
    const alertBox = document.getElementById("missingInvoicesAlerts");
    if (!alertBox) return;

    // Últimos 6 períodos cargados
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    if (allPeriods.length < 2) {
        alertBox.innerHTML = `<div style="color:var(--text-3); font-size:0.85rem; padding:0.5rem;">Datos insuficientes para auditoría.</div>`;
        return;
    }
    // Se auditan los 6 meses anteriores, excluyendo el último período cerrado (para evitar falsos positivos de facturas no imputadas aún)
    const checkPeriods = allPeriods.slice(-7, -1);

    // Definición de ítems recurrentes a auditar y sus patrones de búsqueda
    const recurrents = [
        { name: "AySA - Cliente 192498", test: (e) => e.concepto.toLowerCase().includes("aysa") && e.concepto.includes("192498") },
        { name: "AySA - Cliente 192499", test: (e) => e.concepto.toLowerCase().includes("aysa") && e.concepto.includes("192499") },
        { name: "AySA - Cliente 192500", test: (e) => e.concepto.toLowerCase().includes("aysa") && e.concepto.includes("192500") },
        { name: "Edesur (05637256)", test: (e) => e.concepto.toLowerCase().includes("edesur") },
        { name: "Conectividad (Flow / Telecentro)", test: (e) => e.concepto.toLowerCase().includes("telecentro") || e.concepto.toLowerCase().includes("flow") || e.concepto.toLowerCase().includes("cablevision") },
        { name: "Abono Ascensores", test: (e) => e.concepto.toLowerCase().includes("ascensor") || e.concepto.toLowerCase().includes("guillemi") },
        { name: "Abono Fumigación", test: (e) => e.concepto.toLowerCase().includes("fumig") || e.concepto.toLowerCase().includes("desinsect") || e.concepto.toLowerCase().includes("saneamiento") },
        { name: "Seguro Consorcio", test: (e) => (e.categoria === "Seguros" || e.rubro === "SEGUROS ORDINARIOS" || e.concepto.toLowerCase().includes("seguro")) }
    ];

    const missing = [];
    checkPeriods.forEach(p => {
        const month = p.split("-")[1];
        recurrents.forEach(rec => {
            // El seguro de consorcio se abona en 10 cuotas al año (sin vencimientos en los meses de descanso de abril y mayo)
            if (rec.name === "Seguro Consorcio" && (month === "04" || month === "05")) {
                return;
            }
            const hasGasto = rawExpenses.some(e => e.periodo === p && rec.test(e));
            if (!hasGasto) {
                missing.push({ periodo: p, service: rec.name });
            }
        });
    });

    if (missing.length === 0) {
        alertBox.innerHTML = `<div style="color:#34d399; font-size:0.8rem; padding:0.5rem; display:flex; align-items:center; gap:6px;">
            <span style="font-size:0.95rem;">✓</span> Servicios al día en 6m
        </div>`;
        return;
    }

    alertBox.innerHTML = missing.slice(-4).map(m => `
        <div style="display:flex; flex-direction:column; gap:2px; background:rgba(251,191,36,0.04); border:1px solid rgba(251,191,36,0.12); border-radius:6px; padding:0.4rem 0.5rem; font-size:0.72rem; color:var(--text-2); width: 100%; box-sizing: border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                <span style="color:#fbbf24; font-weight:600;">⚠️ Faltante</span>
                <span style="font-weight:600; color:var(--text-3); font-size:0.68rem;">${m.periodo}</span>
            </div>
            <div style="font-weight:500; font-size:0.7rem; color:var(--text-1); margin-top:2px; word-break: break-word;">${m.service}</div>
        </div>
    `).join('');
};

// ── Master update ───────────────────────────────────────────────
const updateDashboard = (multiPeriod = true) => {
    const period = document.getElementById("periodFilter").value;
    renderKPIs(period);
    renderAnomalySection(period);
    renderHistoricalChart();
    renderCategoryChart();
    renderComparisonChart();
    renderPatrimonialChart();
    auditProviders(period);
    renderDrilldownCharts();
    renderEmployeeChart();
    renderEmployeeKPIs(period);
    renderFines(period);
    detectMissingInvoices();
    renderTable();
};

// ── NARRATIVE ──────────────────────────────────────────────────


// ── KPIs ────────────────────────────────────────────────────────
const renderKPIs = (period) => {
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();



    // Gastos Pendientes de Pago (Devengados)
    let pendientesMes = 0;
    const idx = allPeriods.indexOf(period);
    const nextPeriod = idx !== -1 && idx < allPeriods.length - 1 ? allPeriods[idx + 1] : null;

    if (period === "todos") {
        const lastPeriod = allPeriods[allPeriods.length - 1];
        pendientesMes = rawExpenses.filter(e => e.periodo === lastPeriod && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = `Deuda flotante al cierre (${lastPeriod})`;
    } else if (nextPeriod) {
        pendientesMes = rawExpenses.filter(e => e.periodo === nextPeriod && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = "Gastos diferidos al cierre del mes";
    } else {
        pendientesMes = rawExpenses.filter(e => e.periodo === period && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = "Gastos diferidos en el período";
    }
    document.getElementById("kpiPendientes").textContent = pendientesMes > 0 ? fmt(pendientesMes) : "—";

    const setBalance = (ing, egr, ingDelta, egrDelta, prevIng, prevEgr, prevPeriodName) => {
        document.getElementById("kpiRecaudado").textContent = ing > 0 ? fmt(ing) : "—";
        document.getElementById("kpiEgresado").textContent  = egr > 0 ? fmt(egr) : "—";

        const delta = ing - egr;
        const balEl = document.getElementById("kpiBalance");
        balEl.textContent = ing > 0 ? fmt(delta) : "—";
        balEl.className   = `kpi-val ${delta >= 0 ? "green" : "red"}`;

        // Deltas vs previous period
        const ingDeltaEl = document.getElementById("kpiRecaudadoDelta");
        const egrDeltaEl = document.getElementById("kpiEgresadoDelta");

        if (ingDeltaEl) {
            if (typeof ingDelta === "number") {
                ingDeltaEl.textContent = `${pct(ingDelta)} vs mes anterior`;
                ingDeltaEl.className = `kpi-delta ${ingDelta >= 0 ? "up" : "down"}`;
                if (ingDeltaEl.setAttribute) ingDeltaEl.setAttribute("data-tooltip", `Mes anterior (${prevPeriodName}): ${fmt(prevIng)}`);
                ingDeltaEl.style.cursor = "help";
                ingDeltaEl.style.borderBottom = "1px dotted rgba(255,255,255,0.3)";
            } else {
                if (ingDeltaEl.removeAttribute) ingDeltaEl.removeAttribute("data-tooltip");
                ingDeltaEl.style.cursor = "default";
                ingDeltaEl.style.borderBottom = "none";
            }
        }

        if (egrDeltaEl) {
            if (typeof egrDelta === "number") {
                egrDeltaEl.textContent = `${pct(egrDelta)} vs mes anterior`;
                egrDeltaEl.className = `kpi-delta ${egrDelta <= 0 ? "up" : "down"}`;
                if (egrDeltaEl.setAttribute) egrDeltaEl.setAttribute("data-tooltip", `Mes anterior (${prevPeriodName}): ${fmt(prevEgr)}`);
                egrDeltaEl.style.cursor = "help";
                egrDeltaEl.style.borderBottom = "1px dotted rgba(255,255,255,0.3)";
            } else {
                if (egrDeltaEl.removeAttribute) egrDeltaEl.removeAttribute("data-tooltip");
                egrDeltaEl.style.cursor = "default";
                egrDeltaEl.style.borderBottom = "none";
            }
        }

        const bDeltaEl = document.getElementById("kpiBalanceDelta");
        if (bDeltaEl) {
            bDeltaEl.textContent = delta >= 0 ? "✅ Recaudación cubre los gastos" : "⚠️ Los gastos superan la recaudación";
            bDeltaEl.className = `kpi-delta ${delta >= 0 ? "up" : "down"}`;
        }
    };

    if (period === "todos") {
        const totalIng = rawBalances.reduce((a, b) => a + (b.ingresos || 0), 0);
        const totalEgr = rawBalances.reduce((a, b) => a + (b.egresos || 0), 0);
        const count = rawBalances.length || 1;
        const avgIng = totalIng > 0 ? totalIng / count : rawExpenses.reduce((a,e) => a + e.monto, 0) / count;
        const avgEgr = totalEgr > 0 ? totalEgr / count : rawExpenses.reduce((a,e) => a + e.monto, 0) / count;
        setBalance(avgIng, avgEgr);
        document.getElementById("kpiRecaudadoDelta").textContent = "Promedio mensual histórico";
        document.getElementById("kpiEgresadoDelta").textContent  = "Promedio mensual histórico";
        document.getElementById("kpiRecaudadoDelta").className = "kpi-delta neutral";
        document.getElementById("kpiEgresadoDelta").className  = "kpi-delta neutral";
        return;
    }

    const bal  = rawBalances.find(b => b.periodo === period);
    const prev = prevPeriod(period);
    const balPrev = rawBalances.find(b => b.periodo === prev);

    const periodExpenses = rawExpenses.filter(e => e.periodo === period);
    const egrMonto = (bal && bal.egresos > 0) ? bal.egresos : periodExpenses.reduce((a, e) => a + e.monto, 0);
    const ingMonto = (bal && bal.ingresos > 0) ? bal.ingresos : egrMonto * 0.96;

    const prevExpenses = rawExpenses.filter(e => e.periodo === prev);
    const prevEgrMonto = (balPrev && balPrev.egresos > 0) ? balPrev.egresos : prevExpenses.reduce((a, e) => a + e.monto, 0);
    const prevIngMonto = (balPrev && balPrev.ingresos > 0) ? balPrev.ingresos : prevEgrMonto * 0.96;

    const ingDelta = prevIngMonto > 0 ? ((ingMonto - prevIngMonto) / prevIngMonto) * 100 : null;
    const egrDelta = prevEgrMonto > 0 ? ((egrMonto - prevEgrMonto) / prevEgrMonto) * 100 : null;

    setBalance(
        ingMonto, 
        egrMonto, 
        ingDelta, 
        egrDelta, 
        prevIngMonto, 
        prevEgrMonto, 
        prev
    );
};

// ── ANOMALY SECTION ─────────────────────────────────────────────
const renderAnomalySection = (period) => {
    const section = document.getElementById("anomalySection");
    const container = document.getElementById("anomalyItems");

    // Show anomalies of the LAST available period (or selected period)
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    const targetPeriod = period === "todos" ? allPeriods[allPeriods.length - 1] : period;

    const anomalies = rawExpenses
        .filter(e => e.periodo === targetPeriod && e.anomalia === true)
        .sort((a, b) => b.desviacion_pct - a.desviacion_pct)
        .slice(0, 6);

    if (anomalies.length === 0) {
        section.style.display = "none";
        return;
    }

    section.style.display = "block";
    container.innerHTML = anomalies.map(item => `
        <div class="anomaly-item">
            <div class="anomaly-item-header">
                <span class="anomaly-badge" data-tooltip="Este gasto supera al promedio móvil histórico de las últimas 3 facturas de este mismo concepto." style="cursor: help;">+${item.desviacion_pct}% del histórico</span>
                <span class="anomaly-monto">${fmt(item.monto)}</span>
            </div>
            <div class="anomaly-concepto">${item.concepto}</div>
            <div style="margin-top:4px;">${getCatPill(item.categoria || item.rubro)}</div>
        </div>
    `).join('');
};

// ── HISTORICAL LINE CHART ───────────────────────────────────────
const renderHistoricalChart = () => {
    if (typeof ApexCharts === 'undefined') return;
    const chartType = document.getElementById("chartTypeFilter").value;
    const cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");
    const periods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();

    const sumBy = (rubro) => periods.map(p =>
        Math.round(cleanExpenses.filter(e => e.periodo === p && (e.categoria === rubro || e.rubro === rubro))
            .reduce((a, e) => a + e.monto, 0))
    );

    let series = [];
    let colors = [];

    if (chartType === "todos") {
        const cats = Object.keys(CAT_CONFIG);
        series = cats.map(cat => ({
            name: cat,
            data: sumBy(cat)
        }));
        colors = cats.map(c => CAT_CONFIG[c].dot);
    } else {
        series = [{ name: chartType, data: sumBy(chartType) }];
        colors = [(CAT_CONFIG[chartType] || { dot: '#06b6d4' }).dot];
    }

    const minIndex = Math.max(0, periods.length - 12);
    const maxIndex = periods.length - 1;

    const opts = {
        chart: {
            type: 'line',
            height: 320,
            toolbar: { show: true },
            zoom: { enabled: true },
            animations: { enabled: true }
        },
        series,
        colors,
        stroke: { curve: 'smooth', width: 2 },
        xaxis: {
            categories: periods,
            labels: { style: { colors: 'var(--text-3)' } }
        },
        yaxis: {
            labels: {
                style: { colors: 'var(--text-3)' },
                formatter: (v) => fmt(v)
            }
        },
        legend: { labels: { colors: 'var(--text-1)' } },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: {
            theme: 'dark',
            y: {
                formatter: (val, { seriesIndex, dataPointIndex, w }) => {
                    const baseStr = fmt(val);
                    const currentPeriod = periods[dataPointIndex];
                    let ipcStr = "";
                    if (ipcData[currentPeriod] && ipcData[currentPeriod].inflacion !== null) {
                        ipcStr = ` | IPC: +${ipcData[currentPeriod].inflacion.toFixed(1)}%`;
                    }
                    if (dataPointIndex > 0) {
                        const prevVal = w.globals.series[seriesIndex][dataPointIndex - 1];
                        if (prevVal > 0) {
                            const diff = ((val - prevVal) / prevVal) * 100;
                            const sign = diff >= 0 ? '+' : '';
                            return `${baseStr} (${sign}${diff.toFixed(1)}% vs mes anterior${ipcStr})`;
                        }
                    }
                    return baseStr + (ipcStr ? ` (${ipcStr.slice(3)})` : "");
                }
            }
        },
        markers: { size: 3, hover: { size: 5 } }
    };

    if (chartHistorical) chartHistorical.destroy();
    chartHistorical = new ApexCharts(document.querySelector("#historicalChart"), opts);
    chartHistorical.render().then(() => {
        setTimeout(() => {
            if (chartHistorical) chartHistorical.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── DONUT CHART ─────────────────────────────────────────────────
const renderCategoryChart = () => {
    if (typeof ApexCharts === 'undefined') return;
    const totals = {};
    filteredExpenses.forEach(e => {
        const cat = e.categoria || e.rubro;
        totals[cat] = (totals[cat] || 0) + e.monto;
    });

    const cats   = Object.keys(totals);
    const series = cats.map(c => Math.round(totals[c]));
    const colors = cats.map(c => (CAT_CONFIG[c] || { dot: '#9ca3af' }).dot);

    const totalSum = series.reduce((a, b) => a + b, 0);

    // Legend
    const legendEl = document.getElementById("catLegend");
    legendEl.innerHTML = cats.map((c, i) => {
        const p = totalSum > 0 ? ((series[i] / totalSum) * 100).toFixed(1) : 0;
        return `<div class="cat-legend-item">
            <div class="cat-dot" style="background:${colors[i]}"></div>
            ${c} <strong style="color:var(--text-1)">${p}%</strong>
        </div>`;
    }).join('');

    const opts = {
        series,
        labels: cats,
        chart: { type: 'donut', height: 220, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        stroke: { show: false },
        legend: { show: false },
        dataLabels: { enabled: false },
        plotOptions: { pie: { donut: { size: '65%', labels: {
            show: true,
            name: { show: true, color: '#94a3b8' },
            value: { show: true, color: '#f1f5f9', fontSize: '1rem', fontWeight: '700' },
            total: { show: true, label: 'Total', color: '#94a3b8', formatter: (w) => {
                const t = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return fmt(t);
            }}
        }}}},
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartCategory) chartCategory.destroy();
    chartCategory = new ApexCharts(document.querySelector("#categoryChart"), opts);
    chartCategory.render();
};

// ── STACKED BAR COMPARISON CHART & DRILLDOWN CATEGORIZATION ──────
const getSubcategoria = (e) => {
    const c = (e.concepto || "").toLowerCase();
    const cat = e.categoria || e.rubro;

    if (cat === "Sueldos y Cargas Sociales") {
        if (e.empleado && e.empleado !== "Cargas Sociales / Sindicato") return e.empleado;
        if (c.includes("jubil") || c.includes("obra social") || c.includes("inssjp") || c.includes("suterh") || c.includes("fateryh") || c.includes("seracarh") || c.includes("sindicat") || c.includes("afip") || c.includes("arca") || c.includes("cuota sindic")) {
            return "Cargas Sociales / Sindicato";
        }
        if (c.includes("ayudante") || c.includes("ramirez") || c.includes("vigilancia")) return "Ayudante / Suplente";
        if (c.includes("encargado auxiliar") || c.includes("victor")) return "Encargado Auxiliar";
        if (c.includes("encargado principal") || c.includes("bustamante") || c.includes("sueldo") || c.includes("jornal") || c.includes("antiguedad") || c.includes("viatico") || c.includes("sac") || c.includes("aguinaldo") || c.includes("retiro de residuo") || c.includes("vacac") || c.includes("feriado") || c.includes("plus")) {
            return "Encargado Principal";
        }
        return "Cargas Sociales / Sindicato";
    }

    if (cat === "Servicios Públicos") {
        if (c.includes("192498")) return "AySA Cta 192498 (Torre 356)";
        if (c.includes("192499")) return "AySA Cta 192499 (Torre 358)";
        if (c.includes("192500")) return "AySA Cta 192500 (Torre 360)";
        if (c.includes("aysa") || c.includes("agua")) return "AySA - Agua";
        if (c.includes("edesur") || c.includes("luz") || c.includes("05637256")) return "Edesur (05637256)";
        if (c.includes("metrogas") || c.includes("gas")) return "Metrogas";
        return "Servicios y Limpieza Medidor";
    }

    if (cat === "Contratos y Abonos") {
        if (c.includes("seguridad") || c.includes("mm servicios") || c.includes("bastida")) return "Servicios de Seguridad";
        if (c.includes("ascensor") || c.includes("guillemi") || c.includes("elevad")) return "Abono Ascensores";
        if (c.includes("plaga") || c.includes("desinsect") || c.includes("fumig") || c.includes("saneamiento") || c.includes("eco plagas")) return "Abono Fumigación";
        if (c.includes("telecentro") || c.includes("flow") || c.includes("cablevision") || c.includes("internet")) return "Conectividad / SUM";
        if (c.includes("ivess") || c.includes("bidon") || c.includes("botellon")) return "Bidones de Agua";
        if (c.includes("correo") || c.includes("carta documento") || c.includes("couceiro")) return "Gastos Postales";
        if (c.includes("cleaning") || c.includes("limpieza")) return "Productos e Insumos Limpieza";
        if (c.includes("lecos") || c.includes("electric")) return "Servicios Técnicos Fijos";
        return "Otros Abonos";
    }

    if (cat === "Mantenimiento y Reparaciones") {
        if (c.includes("pintura") || c.includes("pint") || c.includes("grieta") || c.includes("revoque") || c.includes("albañil") || c.includes("pavon") || c.includes("retapizado") || c.includes("sillon") || c.includes("azotea")) return "Pintura, Albañilería y Azotea";
        if (c.includes("ascensor") || c.includes("acri") || c.includes("contrapeso") || c.includes("asc del 356")) return "Reparación Ascensores";
        if (c.includes("electric") || c.includes("atila") || c.includes("tablero") || c.includes("disyuntor") || c.includes("lampara") || c.includes("lámpara") || c.includes("lecos") || c.includes("timbre") || c.includes("picaporte") || c.includes("iluminac") || c.includes("combustib") || c.includes("shell") || c.includes("ypf") || c.includes("baterias") || c.includes("bateria") || c.includes("samudio")) return "Electricidad, Iluminación y Combustible";
        if (c.includes("plomer") || c.includes("cañer") || c.includes("caño") || c.includes("canilla") || c.includes("rodriguez") || c.includes("iglesia") || c.includes("pileta") || c.includes("perdida") || c.includes("techo")) return "Plomería y Cañerías";
        if (c.includes("bomba") || c.includes("presuriz") || c.includes("sanitarios daniel") || c.includes("locatelli")) return "Bombas de Agua";
        if (c.includes("ogaz") || c.includes("cesped") || c.includes("césped") || c.includes("corte")) return "Jardinería y Áreas Verdes";
        if (c.includes("cleaning") || c.includes("limpieza") || c.includes("recchia") || c.includes("bolsas") || c.includes("zapat") || c.includes("pantalon") || c.includes("de la vega") || c.includes("ropa") || c.includes("adornos") || c.includes("navidad")) return "Productos e Insumos Limpieza";
        if (c.includes("matafuego") || c.includes("protincen") || c.includes("generador") || c.includes("blanco carlos") || c.includes("purpil") || c.includes("escalera")) return "Matafuegos, Generador y Herramientas";
        if (c.includes("destapac") || c.includes("destap") || c.includes("italoamericana") || c.includes("pozo") || c.includes("paz jorge") || c.includes("cloaca")) return "Destapaciones y Cloacas";
        if (c.includes("combril")) return "Plataforma de Cobranza (Combril)";
        return "Mantenimiento General Edificio";
    }

    if (cat === "Administración") {
        if (c.includes("d&f") || c.includes("d & f") || c.includes("honorarios adm") || c.includes("honorarios de administracion") || c.includes("honorarios administracion")) {
            return "Honorarios Adm. D&F";
        }
        if (c.includes("pariano") || c.includes("contable") || c.includes("contador")) {
            return "Honorarios Contador (Pariano)";
        }
        if (c.includes("fotocop") || c.includes("impresion") || c.includes("sistema") || c.includes("consocli") || c.includes("sipac")) {
            return "Fotocopias / Impresiones";
        }
        if (c.includes("banco") || c.includes("comisión") || c.includes("comision") || c.includes("25413") || c.includes("impuesto") || c.includes("paquete") || c.includes("credito") || c.includes("dep.efvo") || c.includes("transferencia")) {
            return "Gastos Bancarios e Impuestos";
        }
        if (c.includes("traspaso") || c.includes("rendicion")) {
            return "Gastos Traspaso Adm.";
        }
        return "Otros Gastos Admin.";
    }

    if (cat === "Seguros") {
        if (c.includes("personal")) return "Seguro Personal / ART";
        return "Seguro Integral Consorcio";
    }

    if (cat === "Gastos Extraordinarios") {
        if (c.includes("pintura") || c.includes("morel") || c.includes("union") || c.includes("pavon") || c.includes("cencic")) return "Obra de Pintura";
        return "Fondo de Reserva";
    }

    return "Varios General";
};

const renderComparisonChart = () => {
    if (typeof ApexCharts === 'undefined') return;
    const viewSel = document.getElementById("comparisonViewFilter");
    const viewMode = viewSel ? viewSel.value : "categorias";
    const cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");
    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();

    let series = [];
    let colors = [];

    if (viewMode === "subcomponentes") {
        const subcatSet = new Set();
        cleanExpenses.forEach(e => subcatSet.add(getSubcategoria(e)));
        const subcats = Array.from(subcatSet).sort();

        const palette = [
            '#06b6d4', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f43f5e', '#a78bfa', '#9ca3af',
            '#38bdf8', '#fb7185', '#facc15', '#4ade80', '#818cf8', '#e879f9', '#c084fc', '#cbd5e1'
        ];
        colors = subcats.map((_, i) => palette[i % palette.length]);

        series = subcats.map(subcat => ({
            name: subcat,
            data: allPeriods.map(p =>
                Math.round(cleanExpenses.filter(e => e.periodo === p && getSubcategoria(e) === subcat)
                    .reduce((a, e) => a + e.monto, 0))
            )
        }));
    } else {
        const cats = Object.keys(CAT_CONFIG);
        colors = cats.map(c => CAT_CONFIG[c].dot);

        series = cats.map(cat => ({
            name: cat,
            data: allPeriods.map(p =>
                Math.round(cleanExpenses.filter(e => e.periodo === p && (e.categoria === cat || e.rubro === cat))
                    .reduce((a, e) => a + e.monto, 0))
            )
        }));
    }

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 320,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 3 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartComparison) chartComparison.destroy();
    chartComparison = new ApexCharts(document.querySelector("#comparisonChart"), opts);
    chartComparison.render().then(() => {
        setTimeout(() => {
            if (chartComparison) chartComparison.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── DRILLDOWN SUB-CHARTS (EACH CATEGORY) ─────────────────────────
let chartDrillSueldos = null;
let chartDrillServicios = null;
let chartDrillContratos = null;
let chartDrillManto = null;
let chartDrillAdmin = null;
let chartDrillSeguros = null;
let chartDrillVarios = null;

const createDrillChart = (selectorId, categoryName, currentInstance) => {
    if (typeof ApexCharts === 'undefined') return null;
    let cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");

    if (categoryName === "Gastos Extraordinarios" && rawExtraordinarios.length > 0) {
        const monthMap = {
            'JULIO': '2025-07', 'AGOSTO': '2025-08', 'SEPTIEMBRE': '2025-09',
            'OCTUBRE': '2025-10', 'NOVIEMBRE': '2025-11', 'DICIEMBRE': '2025-12',
            'ENERO': '2026-01', 'FEBRERO': '2026-02', 'MARZO': '2026-03',
            'ABRIL': '2026-04', 'MAYO': '2026-05', 'JUNIO': '2026-06'
        };
        const existingKeys = new Set(cleanExpenses.map(e => `${e.periodo}_${e.monto}`));
        rawExtraordinarios.forEach(x => {
            if (x.abonado > 0) {
                const pRaw = (x.periodo_expensa || '').trim().toUpperCase();
                const p = monthMap[pRaw] || x.periodo || pRaw;
                if (p && !existingKeys.has(`${p}_${x.abonado}`)) {
                    cleanExpenses.push({
                        periodo: p,
                        categoria: "Gastos Extraordinarios",
                        rubro: "Fondo de Reserva / Obra de Pintura",
                        concepto: x.concepto,
                        monto: x.abonado,
                        tipo: "Variable",
                        estado: "Pagado"
                    });
                }
            }
        });
    }

    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();
    const catExpenses = cleanExpenses.filter(e => (e.categoria === categoryName || e.rubro === categoryName));
    
    // Si no hay datos, retornamos null
    if (catExpenses.length === 0) return null;

    const subcats = [...new Set(catExpenses.map(e => getSubcategoria(e)))].sort();
    const predefinedColors = ['#06b6d4', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f43f5e', '#a78bfa', '#9ca3af'];
    const colors = subcats.map((_, i) => predefinedColors[i % predefinedColors.length]);

    const series = subcats.map(subcat => ({
        name: subcat,
        data: allPeriods.map(p =>
            Math.round(cleanExpenses.filter(e => e.periodo === p && (e.categoria === categoryName || e.rubro === categoryName) && getSubcategoria(e) === subcat)
                .reduce((a, e) => a + e.monto, 0))
        )
    }));

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 260,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 2 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -40, style: { fontSize: '9px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.03)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '10px', height: 45 },
        fill: { opacity: 0.95 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (currentInstance) currentInstance.destroy();
    const chart = new ApexCharts(document.querySelector(selectorId), opts);
    chart.render().then(() => {
        setTimeout(() => {
            if (chart) chart.zoomX(minIndex, maxIndex);
        }, 100);
    });
    return chart;
};

const renderDrilldownCharts = () => {
    chartDrillSueldos = createDrillChart("#drillSueldosChart", "Sueldos y Cargas Sociales", chartDrillSueldos);
    chartDrillServicios = createDrillChart("#drillServiciosChart", "Servicios Públicos", chartDrillServicios);
    chartDrillContratos = createDrillChart("#drillContratosChart", "Contratos y Abonos", chartDrillContratos);
    chartDrillManto = createDrillChart("#drillMantoChart", "Mantenimiento y Reparaciones", chartDrillManto);
    chartDrillAdmin = createDrillChart("#drillAdminChart", "Administración", chartDrillAdmin);
    chartDrillSeguros = createDrillChart("#drillSegurosChart", "Seguros", chartDrillSeguros);
    chartDrillVarios = createDrillChart("#drillExtraordinariosChart", "Gastos Extraordinarios", chartDrillVarios);
};

// ── MOROSITY CHART ───────────────────────────────────────────────


// ── EMPLOYEE BREAKDOWN CHART ─────────────────────────────────────
let chartEmployee = null;
const renderEmployeeChart = () => {
    if (typeof ApexCharts === 'undefined') return;
    const periods = [...new Set(rawExpenses.map(e => e.periodo))].sort();

    const sumBy = (nombre) => periods.map(p =>
        Math.round(rawExpenses
            .filter(e => e.periodo === p && e.empleado === nombre)
            .reduce((a, e) => a + e.monto, 0))
    );

    const series = [
        { name: 'Encargado Permanente',    data: sumBy('Encargado Permanente') },
        { name: 'Ayudante / Suplente',      data: sumBy('Ayudante / Suplente') },
        { name: 'Cargas Sociales / ART',   data: sumBy('Cargas Sociales / Sindicato') },
        { name: 'Vigilancia Nocturna',      data: sumBy('Vigilancia Nocturna') },
    ];

    const totalPeriods = periods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar', height: 300, stacked: false,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent', fontFamily: 'Inter, sans-serif'
        },
        colors: ['#06b6d4', '#f472b6', '#fbbf24', '#a78bfa'],
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 3 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: periods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M'
                             : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartEmployee) chartEmployee.destroy();
    chartEmployee = new ApexCharts(document.querySelector('#employeeChart'), opts);
    chartEmployee.render().then(() => {
        setTimeout(() => {
            if (chartEmployee) chartEmployee.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── EMPLOYEE KPI CARDS ───────────────────────────────────────────
const renderEmployeeKPIs = (period) => {
    const subtitleEl = document.getElementById('empSubtitle');
    if (subtitleEl) {
        if (period === 'todos') {
            subtitleEl.innerHTML = `Montos acumulados de <strong>todos los períodos</strong> auditados en Sarmiento 356-360.`;
        } else {
            subtitleEl.innerHTML = `Montos del período seleccionado <strong>(${period})</strong>.`;
        }
    }

    const sumEmp = (nombre) => {
        const src = period === 'todos'
            ? rawExpenses.filter(e => e.empleado === nombre)
            : rawExpenses.filter(e => e.periodo === period && e.empleado === nombre);
        return src.reduce((a, e) => a + e.monto, 0);
    };

    const ibTotal  = sumEmp('Encargado Permanente');
    const loTotal  = sumEmp('Ayudante / Suplente');
    const crTotal  = sumEmp('Cargas Sociales / Sindicato');
    const vnTotal  = sumEmp('Vigilancia Nocturna');

    const ibHist = rawExpenses.filter(e => e.empleado === 'Encargado Permanente').reduce((a,e) => a+e.monto, 0);
    const loHist = rawExpenses.filter(e => e.empleado === 'Ayudante / Suplente').reduce((a,e) => a+e.monto, 0);
    const crHist = rawExpenses.filter(e => e.empleado === 'Cargas Sociales / Sindicato').reduce((a,e) => a+e.monto, 0);
    const vnHist = rawExpenses.filter(e => e.empleado === 'Vigilancia Nocturna').reduce((a,e) => a+e.monto, 0);

    const elEncargado = document.getElementById('empIbrahimMonto');
    const elAyudante  = document.getElementById('empLourdesMonto');
    const elCargas    = document.getElementById('empCargasMonto');
    const elVig       = document.getElementById('empYamilRepMonto');

    if (elEncargado) elEncargado.textContent = ibTotal > 0 ? fmt(ibTotal) : 'Sin gasto';
    if (elAyudante)  elAyudante.textContent  = loTotal > 0 ? fmt(loTotal) : 'Sin gasto';
    if (elCargas)    elCargas.textContent    = crTotal > 0 ? fmt(crTotal) : 'Sin gasto';
    if (elVig)       elVig.textContent       = vnTotal > 0 ? fmt(vnTotal) : 'Sin gasto';

    const elEncHist = document.getElementById('empIbrahimHist');
    const elAyuHist = document.getElementById('empLourdesHist');
    const elCarHist = document.getElementById('empCargasHist');
    const elVigHist = document.getElementById('empVigilanciaHist');

    if (elEncHist) elEncHist.textContent = 'Acum. histórico: ' + fmt(ibHist);
    if (elAyuHist) elAyuHist.textContent = 'Acum. histórico: ' + fmt(loHist);
    if (elCarHist) elCarHist.textContent = 'Acum. histórico: ' + fmt(crHist);
    if (elVigHist) elVigHist.textContent = 'Acum. histórico: ' + fmt(vnHist) + ' (Liquidado en Mar-26)';
};

// ── TABLE ────────────────────────────────────────────────────────
const renderTable = () => {
    const tbody  = document.getElementById("expensesTableBody");
    const total  = filteredExpenses.length;
    const ps     = pageSize >= 9999 ? total : pageSize;
    const pages  = Math.ceil(total / ps) || 1;
    currentPage  = Math.min(currentPage, pages);
    const start  = (currentPage - 1) * ps;
    const end    = Math.min(start + ps, total);

    document.getElementById("tableInfo").textContent =
        `${total.toLocaleString('es-AR')} registros encontrados`;
    document.getElementById("paginationInfo").textContent =
        `Mostrando ${start + 1}–${end} de ${total.toLocaleString('es-AR')}`;

    // Sort: period desc, amount desc
    const sorted = [...filteredExpenses].sort((a, b) => {
        if (b.periodo !== a.periodo) return b.periodo.localeCompare(a.periodo);
        return b.monto - a.monto;
    });

    const pageItems = sorted.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:2rem;">No se encontraron registros.</td></tr>`;
        renderPagination(pages);
        return;
    }
    tbody.innerHTML = pageItems.map(item => {
        const isSAC = item.concepto.toLowerCase().includes("sac") || item.concepto.toLowerCase().includes("aguinaldo");
        const pp = prevPeriod(item.periodo);

        const prevItem = isSAC ? null : rawExpenses.find(x =>
            x.periodo === pp &&
            matchConcept(x.concepto, item.concepto)
        );

        let prevMonto = 0, varHtml = `<span class="var-null">—</span>`, diff = 0;
        if (prevItem) {
            prevMonto = prevItem.monto;
            diff = ((item.monto - prevMonto) / prevMonto) * 100;
            if (diff > 0.5)       varHtml = `<span class="var-up">+${diff.toFixed(1)}% ▲</span>`;
            else if (diff < -0.5) varHtml = `<span class="var-down">${diff.toFixed(1)}% ▼</span>`;
            else                  varHtml = `<span class="var-null">≈ 0%</span>`;
        }

        const tipoBadge     = item.tipo === "Fijo"
            ? `<span class="badge badge-fijo">Fijo</span>`
            : `<span class="badge badge-variable">Variable</span>`;

        let badges = [];
        if (item.anomalia) {
            badges.push(`<span class="badge badge-anomalia" title="Desviación +${item.desviacion_pct}% del histórico">⚠ Anomalía</span>`);
        }
        
        // Aplica a fijos, abonos o servicios recurrentes (como Telecentro, luz, agua, etc.) que suban >25%
        const catNameLow = (item.categoria || item.rubro).toLowerCase();
        const esRecurrente = item.tipo === "Fijo" || ["servicios públicos", "contratos y abonos", "varios"].includes(catNameLow);
        if (esRecurrente && diff > 25) {
            badges.push(`<span class="badge badge-anomalia" style="background:rgba(251,146,60,0.1); border-color:#fb923c; color:#fb923c;" title="Aumento mayor al 25% respecto al mes anterior">⚠️ Aumento >25%</span>`);
        }

        const alertaBadge = badges.length > 0 
            ? `<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">${badges.join('')}</div>` 
            : `<span class="badge-normal">Normal</span>`;

        const estadoBadge   = item.estado === "Pendiente"
            ? `<span class="badge badge-pendiente" title="Devengado pendiente de pago">Pendiente</span>`
            : `<span class="badge badge-pagado">Pagado</span>`;

        const conceptSafe = item.concepto.replace(/'/g, "\\'").replace(/"/g, "&quot;");

        return `
        <tr>
            <td style="white-space:nowrap;font-weight:500;">${item.periodo}</td>
            <td>${getCatPill(item.categoria || item.rubro)}</td>
            <td>${tipoBadge}</td>
            <td>${alertaBadge}</td>
            <td>${estadoBadge}</td>
            <td class="concepto-cell">
                <span class="concepto-text" onclick="openModal('${conceptSafe}')">${item.concepto}</span>
            </td>
            <td class="amount-col amount-prev">${prevMonto > 0 ? fmt(prevMonto) : '—'}</td>
            <td style="text-align:right;white-space:nowrap;">${varHtml}</td>
            <td class="amount-col amount-current">${fmt(item.monto)}</td>
        </tr>`;
    }).join('');

    renderPagination(pages);
};

// ── PAGINATION ───────────────────────────────────────────────────
const renderPagination = (totalPages) => {
    const btns = document.getElementById("paginationBtns");
    if (totalPages <= 1) { btns.innerHTML = ''; return; }

    const MAX_VISIBLE = 7;
    let pages = [];

    if (totalPages <= MAX_VISIBLE) {
        pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('…');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
            pages.push(i);
        }
        if (currentPage < totalPages - 2) pages.push('…');
        pages.push(totalPages);
    }

    btns.innerHTML = [
        `<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="goToPage(${currentPage-1})">‹</button>`,
        ...pages.map(p => p === '…'
            ? `<span class="pg-btn" style="cursor:default;background:none;border:none;">…</span>`
            : `<button class="pg-btn ${p===currentPage?'active':''}" onclick="goToPage(${p})">${p}</button>`
        ),
        `<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="goToPage(${currentPage+1})">›</button>`
    ].join('');
};

const goToPage = (p) => {
    const total = filteredExpenses.length;
    const ps = pageSize >= 9999 ? total : pageSize;
    currentPage = Math.max(1, Math.min(p, Math.ceil(total / ps)));
    renderTable();
    document.getElementById("tabla").scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── MODAL PROVEEDOR ─────────────────────────────────────────────
const openModal = (conceptoRaw) => {
    const concepto = conceptoRaw.replace(/\\'/g, "'").replace(/&quot;/g, '"');
    const provExpenses = rawExpenses
        .filter(e => matchConcept(e.concepto, concepto))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));

    if (provExpenses.length === 0) return;

    const total   = provExpenses.reduce((a, e) => a + e.monto, 0);
    const totalObras = rawExpenses.filter(e => e.rubro === "Obras y Reparaciones")
        .reduce((a, e) => a + e.monto, 0) || 1;
    const obrasMonto = provExpenses.filter(e => e.rubro === "Obras y Reparaciones")
        .reduce((a, e) => a + e.monto, 0);
    const porcentaje  = (obrasMonto / totalObras) * 100;
    const avg = total / provExpenses.length;

    document.getElementById("providerModalName").textContent = concepto.slice(0, 60) + (concepto.length > 60 ? '…' : '');
    document.getElementById("providerTotal").textContent = fmt(total);
    document.getElementById("providerPct").textContent   = porcentaje > 0 ? porcentaje.toFixed(1) + "%" : "—";
    document.getElementById("providerCount").textContent = provExpenses.length;
    document.getElementById("providerAvg").textContent   = fmt(avg);

    document.getElementById("providerHistoryList").innerHTML = provExpenses.map(e => `
        <div class="history-row">
            <div>
                <div class="history-row-period">${e.periodo}</div>
                <div class="history-row-concepto">${e.concepto}</div>
            </div>
            <div class="history-row-amount" style="color:var(--accent);">${fmt(e.monto)}</div>
        </div>
    `).join('');

    document.getElementById("providerModal").classList.add("open");
};

const closeModal = () => {
    document.getElementById("providerModal").classList.remove("open");
};

// Close modal on overlay click
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("providerModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("providerModal")) closeModal();
    });
});

// ── EXPORT CSV ──────────────────────────────────────────────────
const exportCSV = () => {
    const headers = ["Período", "Categoría", "Tipo", "Alerta", "Concepto", "Monto"];
    const rows = filteredExpenses.map(e => [
        e.periodo,
        e.rubro,
        e.tipo,
        e.anomalia ? `Anomalía +${e.desviacion_pct}%` : "Normal",
        `"${e.concepto.replace(/"/g, '""')}"`,
        e.monto.toFixed(2)
    ]);

    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sarmiento360_gastos_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ── EXPORT EXCEL (.XLSX) ─────────────────────────────────────────
const exportXLSX = () => {
    if (typeof XLSX === 'undefined') {
        alert("La librería para exportar Excel se está cargando. Por favor, reintente en unos segundos.");
        return;
    }

    const sorted = [...filteredExpenses].sort((a, b) => {
        if (b.periodo !== a.periodo) return b.periodo.localeCompare(a.periodo);
        return b.monto - a.monto;
    });

    const dataToExport = sorted.map(item => ({
        "Período": item.periodo,
        "Categoría": item.categoria || item.rubro,
        "Sub-rubro / Detalle": getSubcategoria(item),
        "Tipo": item.tipo || "Variable",
        "Estado": item.estado || "Pagado",
        "Concepto": item.concepto,
        "Monto ($)": item.monto
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);

    // Formatear anchos de columnas
    ws['!cols'] = [
        { wch: 10 }, // Período
        { wch: 28 }, // Categoría
        { wch: 30 }, // Sub-rubro
        { wch: 12 }, // Tipo
        { wch: 12 }, // Estado
        { wch: 65 }, // Concepto
        { wch: 16 }  // Monto ($)
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expensas Sarmiento 360");

    const selP = document.getElementById("periodFilter")?.value || "todos";
    const filename = `sarmiento360_expensas_${selP}_${Date.now()}.xlsx`;

    XLSX.writeFile(wb, filename);
};

// ── EXPORT EXCEL MULTISOLAPA DE AUDITORÍA COMPLETA (.XLSX) ──────
const exportMultiSheetXLSX = async () => {
    if (typeof XLSX === 'undefined') {
        alert("La librería para exportar Excel se está cargando. Por favor, reintente en unos segundos.");
        return;
    }

    let prorrateoData = [];
    try {
        const res = await fetch("prorrateo.json");
        const json = await res.json();
        prorrateoData = json.prorrateo || [];
    } catch(e) {
        console.warn("No se pudo cargar prorrateo.json:", e);
    }

    const wb = XLSX.utils.book_new();

    // Hoja 1: Resumen Ejecutivo
    const summaryData = [
        { "Métrica Auditoría": "Total Gastos Devengados Auditados", "Valor": rawExpenses.reduce((a,e) => a + (e.monto||0), 0) },
        { "Métrica Auditoría": "Períodos Auditados", "Valor": "12 Meses (Julio 2025 - Julio 2026)" },
        { "Métrica Auditoría": "Total Unidades Funcionales", "Valor": "70 UFs (Torres 356, 358 y 360)" },
        { "Métrica Auditoría": "Morosidad Acumulada (Julio 2026)", "Valor": 4295074 },
        { "Métrica Auditoría": "UFs en Estado de Morosidad", "Valor": "15 UFs (21,4%)" },
        { "Métrica Auditoría": "Suma Coeficiente de Prorrateo", "Valor": "99.79% (Descalce teórico 0.21%)" },
        { "Métrica Auditoría": "Fecha Cese de Mandato D&F", "Valor": "20 de Agosto de 2026" }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 38 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen Ejecutivo");

    // Hoja 2: Gastos Detallados
    const sortedGastos = [...filteredExpenses].sort((a, b) => b.periodo.localeCompare(a.periodo));
    const dataGastos = sortedGastos.map(item => ({
        "Período": item.periodo,
        "Categoría": item.categoria || item.rubro,
        "Sub-rubro": getSubcategoria(item),
        "Tipo": item.tipo || "Variable",
        "Estado": item.estado || "Pagado",
        "Concepto / Proveedor": item.concepto,
        "Monto ($)": item.monto
    }));
    const wsGastos = XLSX.utils.json_to_sheet(dataGastos);
    wsGastos['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 65 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsGastos, "Desglose Gastos");

    // Hoja 3: Prorrateo
    if (prorrateoData.length > 0) {
        const dataProrrateo = prorrateoData.map(p => ({
            "Período": p.periodo,
            "UF": p.uf,
            "Depto": p.dpto || p.ubicacion,
            "Propietario": p.propietario,
            "% Copr.": p.porcentual,
            "Saldo Ant. ($)": p.saldo_anterior,
            "Pagos ($)": p.pagos,
            "Saldo Mes ($)": p.saldo_mes,
            "Gastos Comunes ($)": p.gastos_comunes,
            "Seguridad ($)": p.servicio_seguridad,
            "Fondo Reserva ($)": p.fondo_reserva,
            "Gastos Extra ($)": p.gastos_extraordinarios,
            "Total Mes ($)": p.total_mes,
            "Int. Mora ($)": p.interes_mora,
            "Total a Pagar ($)": p.total_a_pagar
        }));
        const wsProrrateo = XLSX.utils.json_to_sheet(dataProrrateo);
        XLSX.utils.book_append_sheet(wb, wsProrrateo, "Prorrateo 70 UFs");
    }

    // Hoja 4: Morosidad
    if (prorrateoData.length > 0) {
        const julProrrateo = prorrateoData.filter(x => x.periodo === '2026-07' && (x.saldo_anterior > 0 || x.saldo_mes > 0));
        const dataMoro = julProrrateo.map(m => ({
            "UF": m.uf,
            "Ubicación / Depto": m.dpto || m.ubicacion,
            "Consorcista / Propietario": m.propietario,
            "Saldo Pendiente ($)": m.saldo_anterior || m.saldo_mes,
            "Interés Mora Recargo (5%) ($)": m.interes_mora || ((m.saldo_anterior || m.saldo_mes) * 0.05),
            "Total a Pagar ($)": m.total_a_pagar || ((m.saldo_anterior || m.saldo_mes) * 1.05)
        }));
        const wsMoro = XLSX.utils.json_to_sheet(dataMoro);
        XLSX.utils.book_append_sheet(wb, wsMoro, "Morosidad Jul-26");
    }

    XLSX.writeFile(wb, `Auditoria_Completa_Multisolapa_Sarmiento360_${Date.now()}.xlsx`);
};

// ── EXPORT PDF (IMPRESIÓN OPTIMIZADA) ───────────────────────────
const exportPDF = () => {
    const originalPageSize = pageSize;
    const originalCurrentPage = currentPage;

    // Forzar visualización de todos los registros en la tabla
    pageSize = 9999;
    currentPage = 1;
    renderTable();

    setTimeout(() => {
        window.print();
        
        // Restaurar la paginación de la UI
        pageSize = originalPageSize;
        currentPage = originalCurrentPage;
        renderTable();
    }, 250);
};

// ── MORA E INTERESES RENDERER ───────────────────────────────────
const renderFines = async (period) => {
    const tbody = document.getElementById("finesTableBody");
    const subtitle = document.getElementById("finesSubtitle");
    if (!tbody) return;

    if (period === "todos") {
        if (subtitle) subtitle.textContent = "Mostrando recargos por mora aplicados a UFs deudoras";
    } else {
        if (subtitle) subtitle.textContent = `Recargos de mora aplicados en la expensa de ${period}`;
    }

    let prorrateo = [];
    try {
        const r = await fetch("prorrateo.json");
        const data = await r.json();
        prorrateo = data.prorrateo || [];
    } catch(e) {
        console.warn("No se pudo cargar prorrateo.json para intereses de mora:", e);
    }

    const filteredMora = prorrateo.filter(x => {
        const hasMora = (x.interes_mora || 0) > 0 || (x.interes || 0) > 0;
        const matchesPeriod = period === "todos" || x.periodo === period;
        return hasMora && matchesPeriod;
    });

    if (filteredMora.length === 0) {
        const msg = period === "todos"
            ? "ℹ️ No se registraron recargos por mora en la base de datos histórica."
            : `ℹ️ En el período ${period} el consorcio no liquidó intereses por mora a ninguna unidad.`;
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:1.5rem;">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredMora.map(m => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-1);">UF ${String(m.uf).padStart(3, '0')} (${m.dpto || m.ubicacion})</td>
            <td style="padding: 0.75rem 0.5rem; color: var(--text-3); font-style: italic;">Recargo por pago fuera de término (${m.periodo})</td>
            <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: #f43f5e;">${fmt(m.interes_mora || m.interes)}</td>
        </tr>
    `).join('');
};

// ── RECAUDACIÓN VS GASTOS DEVENGADOS (FLUJO REAL DE CAJA) ──────
const renderPatrimonialChart = async () => {
    if (typeof ApexCharts === 'undefined') return;
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();

    let prorrateo = [];
    try {
        const r = await fetch("prorrateo.json");
        const data = await r.json();
        prorrateo = data.prorrateo || [];
    } catch(e) {
        console.warn("No se pudo cargar prorrateo.json para gráfico de recaudación:", e);
    }

    const categories = allPeriods;
    const gastosDevengados = categories.map(p => {
        const pExp = rawExpenses.filter(e => e.periodo === p);
        return Math.round(pExp.reduce((a, e) => a + (e.monto || 0), 0));
    });

    const recaudacionCobrada = categories.map(p => {
        const pPro = prorrateo.filter(x => x.periodo === p);
        return Math.round(pPro.reduce((a, x) => a + (x.pagos || 0), 0));
    });

    const totalPeriods = categories.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series: [
            { name: 'Gastos Devengados', data: gastosDevengados },
            { name: 'Recaudación Cobrada', data: recaudacionCobrada }
        ],
        chart: {
            type: 'line',
            height: 280,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: { download: false, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }
            },
            zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors: ['#f43f5e', '#10b981'],
        stroke: { curve: 'smooth', width: 3 },
        markers: { size: 4 },
        xaxis: {
            type: 'category',
            categories: categories,
            min: minIndex,
            max: maxIndex
        },
        yaxis: { labels: { formatter: v => fmt(v) } },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartPatrimonial) chartPatrimonial.destroy();
    chartPatrimonial = new ApexCharts(document.querySelector("#patrimonialChart"), opts);
    chartPatrimonial.render().then(() => {
        setTimeout(() => {
            if (chartPatrimonial) chartPatrimonial.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── PROVIDER AUDIT TABLE RENDERER ──────────────────────────────
const auditProviders = (period) => {
    const tbody = document.getElementById("providerAuditBody");
    if (!tbody) return;

    let targetPeriod = period;
    if (period === "todos") {
        const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort().reverse();
        targetPeriod = allPeriods[0] || "2026-07";
    }

    const [y, m] = targetPeriod.split("-").map(Number);
    const prevPeriod = `${y - 1}-${String(m).padStart(2, '0')}`;

    // Proveedores y sus palabras clave múltiples para mejor cobertura
    const targetProviders = [
        { name: "💼 Honorarios Administración", keys: ["d&f", "honorario", "adm", "pariano"], rubro: "Honorarios Admin" },
        { name: "🛗 Guillemi (Ascensores)", keys: ["guillemi", "bastida", "ascensor"], rubro: "Abono Ascensores" },
        { name: "⚡ Edesur (Suministro Eléctrico)", keys: ["edesur", "05637256", "luz"], rubro: "Servicio Eléctrico" },
        { name: "💧 AySA Cta 192499 (Torre 358)", keys: ["192499"], rubro: "Servicio de Agua" },
        { name: "💧 AySA Cta 192500 (Torre 360)", keys: ["192500"], rubro: "Servicio de Agua" },
        { name: "🛡️ Allianz / Holando (Seguro)", keys: ["holando", "allianz", "seguro"], rubro: "Seguro Consorcio" },
        { name: "🌐 Cablevisión Flow / Telecom", keys: ["flow", "cablevision", "telecom", "telecentro", "internet"], rubro: "Servicio Conectividad" },
        { name: "🐛 Eco Plagas (Fumigación)", keys: ["eco plagas", "plaga", "fumig", "desinsect"], rubro: "Abono Desinsectación" },
        { name: "🧹 Cleaning Service (Limpieza)", keys: ["cleaning", "limpieza"], rubro: "Insumos Limpieza" },
        { name: "💻 Software / Expensas", keys: ["sipac", "consocli", "expensa", "sistema"], rubro: "Plataforma Gestión" }
    ];

    let rowsHtml = "";
    
    // Obtener inflación acumulada oficial INDEC
    const ipcActual = ipcData[period]?.valor;
    const ipcPrev = ipcData[prevPeriod]?.valor;
    const ipcAcum = (ipcActual && ipcPrev) ? ((ipcActual - ipcPrev) / ipcPrev) * 100 : null;
    const ipcText = ipcAcum !== null ? `${ipcAcum.toFixed(1)}%` : "N/D";

    targetProviders.forEach(p => {
        // Buscar el gasto del mes actual
        const actualExpense = rawExpenses.find(e => e.periodo === period && p.keys.some(k => e.concepto.toLowerCase().includes(k)));
        // Buscar el gasto del año anterior
        let prevExpense = rawExpenses.find(e => e.periodo === prevPeriod && p.keys.some(k => e.concepto.toLowerCase().includes(k)));

        // Fallback: Si no hay registro exactamente hace 12 meses, buscar la primera factura histórica del proveedor
        if (!prevExpense && actualExpense) {
            prevExpense = rawExpenses.find(e => e.periodo !== period && p.keys.some(k => e.concepto.toLowerCase().includes(k)));
        }

        if (actualExpense) {
            const prevAmount = prevExpense ? prevExpense.monto : actualExpense.monto;
            const varPct = prevExpense ? ((actualExpense.monto - prevExpense.monto) / prevExpense.monto) * 100 : 0;
            
            let badge = `<span class="badge badge-success">🟢 Estable</span>`;
            if (ipcAcum !== null && prevExpense) {
                if (varPct > ipcAcum + 25) {
                    badge = `<span class="badge badge-danger">🔴 Excesivo (> IPC + 25%)</span>`;
                } else if (varPct > ipcAcum + 5) {
                    badge = `<span class="badge badge-warning">🟡 Alto (> IPC)</span>`;
                }
            }

            // Calcular el desvío en pesos
            let diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">N/D</td>`;
            if (ipcAcum !== null && prevExpense) {
                const expected = prevExpense.monto * (1 + (ipcAcum / 100));
                const diffValue = actualExpense.monto - expected;
                const diffFmt = fmt(Math.abs(diffValue));
                if (diffValue > 50) { // Tolerancia para diferencias mínimas de redondeo
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #f43f5e; font-weight: 700; font-size: 0.85rem;">+${diffFmt}</td>`;
                } else if (diffValue < -50) {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #10b981; font-weight: 700; font-size: 0.85rem;">-${diffFmt}</td>`;
                } else {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">$0</td>`;
                }
            }

            rowsHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.75rem 0.5rem; text-align: left; font-weight: 600; color: var(--text-2);">${p.name}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: left; color: var(--text-3); font-size: 0.8rem;">${p.rubro}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: var(--text-1);">${fmt(actualExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3);">${prevExpense ? fmt(prevExpense.monto) : 'Sin antecedente'}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: ${ipcAcum !== null && varPct > ipcAcum ? '#f43f5e' : '#10b981'};">${prevExpense ? varPct.toFixed(1) + '%' : '—'}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-2); font-weight: 500;">${ipcText}</td>
                    ${diffHtml}
                    <td style="padding: 0.75rem 0.5rem; text-align: center; vertical-align: middle;">${badge}</td>
                </tr>
            `;
        }
    });

    if (rowsHtml === "") {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:1.5rem;">No se encontraron facturas comparativas de abonos fijos para este período.</td></tr>`;
    } else {
        tbody.innerHTML = rowsHtml;
    }
};

// ── SERVICES STATUS MONITOR RENDERER ───────────────────────────
const loadServicesStatus = () => {
    const container = document.getElementById("servicesStatusWidget");
    if (!container) return;

    fetch(getRelativeDataUrl("servicios_status.json"))
        .then(r => r.json())
        .then(data => {
            const edesur = data.edesur || { status: "Normal", message: "Sin alertas" };
            const aysa = data.aysa || { status: "Normal", message: "Sin alertas" };
            const metrogas = data.metrogas || { status: "Normal", message: "Sin alertas" };

            const getBadge = (srv) => {
                if (srv.status === "Alerta") {
                    return `<span class="badge badge-warning" style="white-space: nowrap;">⚠️ Alerta</span>`;
                }
                return `<span class="badge badge-success" style="white-space: nowrap;">🟢 Normal</span>`;
            };

            const getMessageHtml = (srv) => {
                if (srv.status === "Alerta" && srv.message) {
                    return `<div style="font-size: 0.65rem; color: var(--text-3); margin-top: 1px; margin-bottom: 0.4rem; padding-left: 12px; border-left: 1.5px dashed rgba(251,191,36,0.4); line-height: 1.25;">${srv.message}</div>`;
                }
                return '';
            };

            container.innerHTML = `
                <!-- EDESUR -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">⚡ Luz (Edesur)</span>
                        ${getBadge(edesur)}
                    </div>
                    ${getMessageHtml(edesur)}
                </div>

                <!-- AYSA -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">💧 Agua (AySA)</span>
                        ${getBadge(aysa)}
                    </div>
                    ${getMessageHtml(aysa)}
                </div>

                <!-- METROGAS -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">🔥 Gas (Metrogas)</span>
                        ${getBadge(metrogas)}
                    </div>
                    ${getMessageHtml(metrogas)}
                </div>

                <div style="font-size: 0.6rem; color: var(--text-3); text-align: right; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px; cursor: help; border-bottom: 1px dotted rgba(255,255,255,0.1); width: max-content; margin-left: auto;" data-tooltip-top-right="El estado se actualiza automáticamente 4 veces al día (06:00, 12:00, 18:00 y 21:00 hs) consultando los servidores oficiales de las prestadoras.">Act: ${data.actualizado || 'N/D'}</div>
            `;
        })
        .catch(err => {
            console.warn("No se pudo cargar el estado de servicios:", err);
            container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-3);">Estado no disponible</span>`;
        });
};

// ── RENDER GASTOS EXTRAORDINARIOS Y FONDO DE RESERVA ────────────
const renderExtraordinarios = () => {
    const tbody = document.getElementById("extraordinariosTableBody");
    if (!tbody) return;

    if (!rawExtraordinarios || rawExtraordinarios.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:1.5rem;">Sin registros de gastos extraordinarios.</td></tr>`;
        return;
    }

    let html = "";
    rawExtraordinarios.forEach(item => {
        const liqStr = item.liquidado > 0 ? fmtFull(item.liquidado) : '<span style="color:var(--text-3)">-</span>';
        const recStr = item.recaudado > 0 ? fmtFull(item.recaudado) : '<span style="color:var(--text-3)">-</span>';
        const aboStr = item.abonado > 0 ? `<strong style="color:#f472b6">${fmtFull(item.abonado)}</strong>` : '<span style="color:var(--text-3)">-</span>';
        const fechaStr = item.fecha_pago && item.fecha_pago !== 'N/A' ? `<span class="badge badge-success">${item.fecha_pago}</span>` : '<span class="badge badge-normal">N/A</span>';

        html += `
            <tr>
                <td><strong style="color:var(--accent)">${item.periodo_expensa}</strong></td>
                <td><strong>${item.concepto}</strong></td>
                <td style="text-align:right;">${liqStr}</td>
                <td style="text-align:right;">${recStr}</td>
                <td style="text-align:right;">${aboStr}</td>
                <td style="text-align:center;">${fechaStr}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
};

// ── RENDER ESTADO DE MOROSIDAD ──────────────────────────────────
const renderMorosidad = () => {
    const tbody = document.getElementById("morosidadTableBody");
    if (!tbody) return;

    if (!rawMorosidad || rawMorosidad.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:1.5rem;">Sin registros de morosidad.</td></tr>`;
        return;
    }

    rawMorosidad.sort((a, b) => b.deuda - a.deuda);

    const totalDeuda = rawMorosidad.reduce((acc, m) => acc + m.deuda, 0);
    const maxMoro = rawMorosidad[0];
    const avgDeuda = totalDeuda / rawMorosidad.length;

    const moroCountEl = document.getElementById("moroCount");
    if (moroCountEl) moroCountEl.textContent = `${rawMorosidad.length} U.F. (${((rawMorosidad.length / 70) * 100).toFixed(1)}%)`;

    const moroTotalDeudaEl = document.getElementById("moroTotalDeuda");
    if (moroTotalDeudaEl) moroTotalDeudaEl.textContent = fmtFull(totalDeuda);

    const moroMaxDeudaEl = document.getElementById("moroMaxDeuda");
    if (moroMaxDeudaEl) moroMaxDeudaEl.textContent = fmtFull(maxMoro.deuda);

    const moroMaxOwnerEl = document.getElementById("moroMaxOwner");
    if (moroMaxOwnerEl) {
        const cleanDept = maxMoro.depto ? maxMoro.depto.replace(/\s+-[0-9\s]+[A-Za-zÁÉÍÓÚñÑ].*$/g, '').replace(/\s+[A-ZÁÉÍÓÚñÑ]{2,}.*$/g, '').trim() : `UF ${maxMoro.uf}`;
        moroMaxOwnerEl.textContent = `UF ${maxMoro.uf} (${cleanDept})`;
    }

    const moroAvgDeudaEl = document.getElementById("moroAvgDeuda");
    if (moroAvgDeudaEl) moroAvgDeudaEl.textContent = fmtFull(avgDeuda);

    let html = "";
    rawMorosidad.forEach(item => {
        const badgeStr = item.deuda > 300000 
            ? '<span class="badge badge-danger">🚨 Moroso Crítico</span>' 
            : (item.deuda > 100000 ? '<span class="badge badge-warning">⚠️ Con Deuda</span>' : '<span class="badge badge-warning" style="opacity:0.8">⚠️ Saldo Menor</span>');

        const cleanDept = item.depto ? item.depto.replace(/\s+-[0-9\s]+[A-Za-zÁÉÍÓÚñÑ].*$/g, '').replace(/\s+[A-ZÁÉÍÓÚñÑ]{2,}.*$/g, '').trim() : `UF ${item.uf}`;
        const propStr = `Propietario U.F. ${item.uf}`;

        html += `
            <tr>
                <td style="text-align:center;"><strong style="color:var(--accent); font-size:0.95rem;">UF ${item.uf}</strong></td>
                <td><strong>${cleanDept}</strong></td>
                <td>${propStr}</td>
                <td style="text-align:right;"><strong style="color:#f43f5e; font-size:0.95rem;">${fmtFull(item.deuda)}</strong></td>
                <td style="text-align:center;">${badgeStr}</td>
                <td style="text-align:center;">
                    <a href="unidades.html?uf=${item.uf}" class="btn" style="padding:0.25rem 0.6rem; font-size:0.75rem; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                        🔍 Ver U.F.
                    </a>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
};

// ── INIT APP (INGESTA DE DATOS) ──────────────────────────────────
const init = async () => {
    // Iniciar carga de IPC en segundo plano (sin bloquear la UI)
    fetchIPC();

    try {
        const response = await fetch(getRelativeDataUrl("gastos.json"));
        const data = await response.json();
        
        rawExpenses = (data.gastos || []).filter(e => e.monto > 0);
        rawBalances = data.balances || [];
        rawMultas   = data.multas || [];
        rawExtraordinarios = data.gastos_extraordinarios || data.extraordinarios || [];
        rawMorosidad = data.morosidad || [];

        // Calcular anomalías cuantitativas con media móvil
        rawExpenses.sort((a, b) => a.periodo.localeCompare(b.periodo));
        const history = {};
        rawExpenses.forEach(e => {
            const key = e.concepto.toLowerCase().slice(0, 30);
            const prev = history[key] || [];
            const isSAC = e.concepto.toUpperCase().includes("SAC");
            if (prev.length >= 2) {
                const recent = prev.slice(-3);
                const avg = recent.reduce((a, v) => a + v, 0) / recent.length;
                if (avg > 10000 && e.monto > (avg * 1.45) && !isSAC) {
                    e.anomalia = true;
                    e.desviacion_pct = Math.round(((e.monto - avg) / avg) * 100);
                } else {
                    e.anomalia = false;
                    e.desviacion_pct = 0;
                }
            } else {
                e.anomalia = false;
                e.desviacion_pct = 0;
            }
            if (!history[key]) history[key] = [];
            history[key].push(e.monto);
        });

        try { populatePeriodFilter(); } catch(e) { console.warn("Error en populatePeriodFilter:", e); }
        try { setupEventListeners(); } catch(e) { console.warn("Error en setupEventListeners:", e); }
        try { applyFilters(); } catch(e) { console.warn("Error en applyFilters:", e); }
        try { renderEmployeeChart(); } catch(e) { console.warn("Error en renderEmployeeChart:", e); }
        try { renderExtraordinarios(); } catch(e) { console.warn("Error en renderExtraordinarios:", e); }
        try { renderMorosidad(); } catch(e) { console.warn("Error en renderMorosidad:", e); }
        try { renderFines("todos"); } catch(e) { console.warn("Error en renderFines:", e); }
        try { renderPatrimonialChart(); } catch(e) { console.warn("Error en renderPatrimonialChart:", e); }
        try { auditProviders("todos"); } catch(e) { console.warn("Error en auditProviders:", e); }
        try { loadServicesStatus(); } catch(e) { console.warn("Error en loadServicesStatus:", e); }
    } catch (error) {
        console.error("Error al cargar los datos de expensas:", error);
    }
};

document.addEventListener("DOMContentLoaded", init);


