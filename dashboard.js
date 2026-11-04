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
let rawMorosidadPorPeriodo = {};
let consorcioMeta = {};
let filteredExpenses = [];
let currentPage  = 1;
let pageSize     = 50;
let ipcData      = {}; // Indexa la inflación del IPC por mes

// Fetch inflación oficial del INDEC (Datos Abiertos) - No bloqueante
const fetchIPC = async () => {
    try {
        const r = await fetch(getRelativeDataUrl("data_ipc_indec.json"));
        if (r.ok) {
            const j = await r.json();
            if (j && j.ipc) {
                j.ipc.forEach(item => {
                    ipcData[item.periodo] = {
                        valor: item.indice,
                        inflacion: item.variacion_mensual_pct
                    };
                });
                return;
            }
        }
    } catch (e) {
        console.warn("Cargando IPC online o baseline:", e);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const r = await fetch("https://apis.datos.gob.ar/series/api/series?ids=148.3_INIVELNAL_DICI_M_26&limit=36&format=json", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!r.ok) return;

        const json = await r.json();
        const dataRows = json.data || [];
        for (let i = 0; i < dataRows.length; i++) {
            const dateStr = dataRows[i][0];
            const val = dataRows[i][1];
            const p = dateStr.slice(0, 7);
            let inflacion = null;
            if (i > 0 && dataRows[i - 1][1] > 0) {
                inflacion = ((val - dataRows[i - 1][1]) / dataRows[i - 1][1]) * 100;
            }
            ipcData[p] = { valor: val, inflacion };
        }
    } catch (e) {
        console.warn("API INDEC no disponible; usando valores locales:", e);
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

const formatMoney = (n) => Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
});

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

let canonicalUfDptoMap = {};

const formatDpto = (strVal, ufNum) => {
    const canon = canonicalUfDptoMap[Number(ufNum)] || "";
    const raw = (strVal && String(strVal).trim()) ? String(strVal).trim() : canon;
    if (!raw) return `U.F. ${ufNum}`;
    const matchTower = raw.match(/(356|358|360)/) || canon.match(/(356|358|360)/);
    const tower = matchTower ? matchTower[1] : "";
    let base = raw
        .replace(/\s*\((?:Torre\s*)?(?:Sarmiento\s*)?(?:356|358|360)\).*$/i, "")
        .replace(/\s*[-–]+\s*(?:Torre\s*)?(?:Sarmiento\s*)?(?:356|358|360).*$/i, "")
        .replace(/\s+(?:Torre\s*)?(?:Sarmiento\s*)?(?:356|358|360)$/i, "")
        .trim();
    if (!base) base = `U.F. ${ufNum}`;
    return tower ? `${base} (Sarmiento ${tower})` : base;
};

// ── Category Pill HTML ──────────────────────────────────────────// 7 Categorías EXACTAS del PDF de liquidaciones
const CAT_CONFIG = {
    "Sueldos y Cargas Sociales":   { cls: "pill-sueldos",   icon: "", dot: "#f87171" },
    "Seguros":                     { cls: "pill-seguros",   icon: "", dot: "#fb923c" },
    "Servicios Públicos":          { cls: "pill-servicios", icon: "", dot: "#fbbf24" },
    "Contratos y Abonos":          { cls: "pill-contratos", icon: "", dot: "#34d399" },
    "Administración":              { cls: "pill-admin",     icon: "", dot: "#60a5fa" },
    "Mantenimiento y Reparaciones":{ cls: "pill-manto",    icon: "", dot: "#a78bfa" },
    "Gastos Extraordinarios":      { cls: "pill-extra",    icon: "", dot: "#ec4899" },
    "Varios":                      { cls: "pill-varios",    icon: "", dot: "#9ca3af" }
};

const getCatPill = (rubro) => {
    const cfg = CAT_CONFIG[rubro] || { cls: "pill-varios", icon: "", dot: "#9ca3af" };
    return `<span class="pill ${cfg.cls}"><span class="cat-dot" style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${cfg.dot}; margin-right:5px; vertical-align:middle;"></span>${rubro}</span>`;
};

// ── Previous period string ──────────────────────────────────────
const prevPeriod = (p) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ── Match concepts intelligently (Semantic Concept Fingerprinting) ──
const semanticFingerprint = (str) => {
    if (!str) return null;
    const s = str.toLowerCase();
    // 1. Suministros por número de cuenta/cliente exacto
    if (s.includes("192498")) return "srv:aysa_192498";
    if (s.includes("192499")) return "srv:aysa_192499";
    if (s.includes("192500")) return "srv:aysa_192500";
    if (s.includes("05637256") || s.includes("edesur")) return "srv:edesur_05637256";
    // 2. Sueldos mensuales por puesto (aislando SAC, Vacaciones, Liquidación Final y ajustes)
    if (s.includes("[encargado titular]")) {
        if (s.includes("sac") || s.includes("aguinaldo")) return "sueldo:titular_sac";
        if (s.includes("vacac")) return "sueldo:titular_vacaciones";
        if (s.includes("dias no trabajados")) return "sueldo:titular_ajuste";
        return "sueldo:titular_mensual";
    }
    if (s.includes("[2° encargado]")) {
        if (s.includes("sac") || s.includes("aguinaldo")) return "sueldo:segundo_sac";
        if (s.includes("vacac")) return "sueldo:segundo_vacaciones";
        if (s.includes("reemplazo")) return "sueldo:segundo_reemplazo";
        return "sueldo:segundo_mensual";
    }
    if (s.includes("[personal nocturno]")) {
        if (s.includes("final")) return "sueldo:nocturno_final";
        if (s.includes("sac") || s.includes("aguinaldo")) return "sueldo:nocturno_sac";
        if (s.includes("vacac")) return "sueldo:nocturno_vacaciones";
        return "sueldo:nocturno_mensual";
    }
    if (s.includes("cargas sociales") || (s.includes("arca") && (s.includes("cargas") || s.includes("estimado")))) {
        return "sueldo:cargas_arca";
    }
    if (s.includes("cuota sindical")) return "sueldo:sindicato_suterh";
    // 3. Abonos y contratos recurrentes (excluyendo diferencias retroactivas y reparaciones puntuales)
    if ((s.includes("mm servicios") || /\bbastida\b/.test(s)) && !s.includes("diferencia") && !s.includes("pago final")) {
        return "abono:seguridad_privada";
    }
    if ((s.includes("guillemi") || s.includes("gillemi")) && (s.includes("mantenim") || s.includes("mant ")) && !s.includes("diferencia")) {
        return "abono:ascensores_guillemi";
    }
    if (s.includes("fb saneamiento")) return "abono:fumigacion_fb";
    if (s.includes("telecentro") || s.includes("flow") || s.includes("cablevision")) return "abono:internet_consorcio";
    if (s.includes("holando")) return "seguro:holando_integral";
    if (s.includes("allianz")) return "seguro:allianz_personal";
    if (s.includes("d&f") || s.includes("fernández") || s.includes("fernandez") || s.includes("villasenin")) {
        return "adm:honorarios_administracion";
    }
    if ((s.includes("pariano") || s.includes("liquidacion sueldo")) && !s.includes("rendicion") && !s.includes("traspaso") && !s.includes("incumplimiento")) {
        return "adm:estudio_contable_pariano";
    }
    if (s.includes("consorcio abierto")) return "adm:plataforma_consorcioabierto";
    return null;
};

const cleanConceptForMatching = (str) => {
    if (!str) return "";
    let s = str.toLowerCase();
    const monthNames = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
        "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "sept", "oct", "nov", "dic"
    ];
    monthNames.forEach(m => {
        s = s.replace(new RegExp("\\b" + m + "\\b", "gi"), "");
    });
    s = s.replace(/\b202[4-9]\b/g, "").replace(/\b2[4-9]\b/g, "");
    return s.replace(/\s+/g, " ").trim();
};

const matchConcept = (c1, c2) => {
    if (!c1 || !c2) return false;
    const fp1 = semanticFingerprint(c1);
    const fp2 = semanticFingerprint(c2);
    if (fp1 || fp2) return fp1 === fp2;

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
        let okStatus = true;
        if (status === "Pagado") {
            okStatus = (e.estado || "Pagado") === "Pagado";
        } else if (status === "Pendiente") {
            okStatus = e.estado === "Pendiente" || (e.saldo_pendiente || 0) > 0;
        }

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
        { name: "Seguridad 24hs (MM / Bastida)", test: (e) => e.concepto.toLowerCase().includes("mm servicios") || /\bbastida\b/i.test(e.concepto) },
        { name: "Abono Ascensores (Guillemi)", test: (e) => e.categoria === "Contratos y Abonos" && (e.concepto.toLowerCase().includes("guillemi") || e.concepto.toLowerCase().includes("gillemi")) },
        { name: "Abono Fumigación (FB Saneamiento)", test: (e) => e.concepto.toLowerCase().includes("fumig") || e.concepto.toLowerCase().includes("desinsect") || e.concepto.toLowerCase().includes("saneamiento") },
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
            Servicios al día en 6m
        </div>`;
        return;
    }

    alertBox.innerHTML = missing.slice(-4).map(m => `
        <div style="display:flex; flex-direction:column; gap:2px; background:rgba(251,191,36,0.04); border:1px solid rgba(251,191,36,0.12); border-radius:6px; padding:0.4rem 0.5rem; font-size:0.72rem; color:var(--text-2); width: 100%; box-sizing: border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                <span style="color:#fbbf24; font-weight:600;">Faltante</span>
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
    renderMorosidad(period);
    renderFines(period);
    detectMissingInvoices();
    renderTable();
};

// ── NARRATIVE ──────────────────────────────────────────────────


// ── KPIs ────────────────────────────────────────────────────────
const renderKPIs = (period) => {
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();



    // Gastos Pendientes de Pago (Pasivos devengados al cierre del período)
    const targetPendPeriod = period === "todos" ? allPeriods[allPeriods.length - 1] : period;
    const targetBal = rawBalances.find(b => b.periodo === targetPendPeriod);
    let pendientesMes = 0;
    if (targetBal && typeof targetBal.pasivos_pendientes === "number" && targetBal.pasivos_pendientes > 0) {
        pendientesMes = targetBal.pasivos_pendientes;
    } else if (targetPendPeriod) {
        pendientesMes = rawExpenses
            .filter(e => e.periodo === targetPendPeriod)
            .reduce((a, e) => a + (e.saldo_pendiente > 0 ? e.saldo_pendiente : (e.estado === "Pendiente" ? e.monto : 0)), 0);
    }
    document.getElementById("kpiPendientesDelta").textContent =
        pendientesMes > 0
            ? `Deuda flotante devengada (${targetPendPeriod})`
            : `Sin pasivos impagos informados (${targetPendPeriod || "—"})`;
    document.getElementById("kpiPendientes").textContent = pendientesMes > 0 ? fmt(pendientesMes) : "$ 0";

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

        const compLabel = (period === "2025-11" && prevPeriodName === "2025-09")
            ? `vs ${prevPeriodName} (sin PDF Oct-25 D&F)`
            : "vs mes anterior";

        if (ingDeltaEl) {
            if (typeof ingDelta === "number") {
                ingDeltaEl.textContent = `${pct(ingDelta)} ${compLabel}`;
                ingDeltaEl.className = `kpi-delta ${ingDelta >= 0 ? "up" : "down"}`;
                if (ingDeltaEl.setAttribute) ingDeltaEl.setAttribute("data-tooltip", `Período comparado (${prevPeriodName}): ${fmt(prevIng)}`);
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
                egrDeltaEl.textContent = `${pct(egrDelta)} ${compLabel}`;
                egrDeltaEl.className = `kpi-delta ${egrDelta <= 0 ? "up" : "down"}`;
                if (egrDeltaEl.setAttribute) egrDeltaEl.setAttribute("data-tooltip", `Período comparado (${prevPeriodName}): ${fmt(prevEgr)}`);
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
            bDeltaEl.textContent = delta >= 0 ? "Recaudación cubre los gastos" : "Los gastos superan la recaudación";
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
    let prev = prevPeriod(period);
    let balPrev = rawBalances.find(b => b.periodo === prev);
    let prevExpenses = rawExpenses.filter(e => e.periodo === prev);
    // 2025-10 no fue entregado en PDF por D&F: comparar 2025-11 contra 2025-09 con aviso explícito
    if (!balPrev && prevExpenses.length === 0) {
        const prev2 = prevPeriod(prev);
        const balPrev2 = rawBalances.find(b => b.periodo === prev2);
        const prevExpenses2 = rawExpenses.filter(e => e.periodo === prev2);
        if (balPrev2 || prevExpenses2.length > 0) {
            prev = prev2;
            balPrev = balPrev2;
            prevExpenses = prevExpenses2;
        }
    }

    const periodExpenses = rawExpenses.filter(e => e.periodo === period);
    const egrMonto = (bal && bal.egresos > 0) ? bal.egresos : periodExpenses.reduce((a, e) => a + e.monto, 0);
    const ingMonto = (bal && bal.ingresos > 0) ? bal.ingresos : 0;
    const prevEgrMonto = (balPrev && balPrev.egresos > 0) ? balPrev.egresos : prevExpenses.reduce((a, e) => a + e.monto, 0);
    const prevIngMonto = (balPrev && balPrev.ingresos > 0) ? balPrev.ingresos : 0;

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
    const cleanExpenses = [...rawExpenses];
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
        annotations: {
            xaxis: [{
                x: '2026-08',
                borderColor: '#22d3ee',
                strokeDashArray: 4,
                label: {
                    borderColor: '#22d3ee',
                    style: { color: '#0f172a', background: '#22d3ee', fontWeight: 700, fontSize: '10px' },
                    text: 'Traspaso Adm. (Ago-26)'
                }
            }]
        },
        legend: { labels: { colors: 'var(--text-1)' } },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: {
            theme: 'dark',
            fillSeriesColor: false,
            shared: true,
            custom: function({ series, seriesIndex, dataPointIndex, w }) {
                const currentPeriod = periods[dataPointIndex] || (w.globals.categoryLabels ? w.globals.categoryLabels[dataPointIndex] : "");
                let ipcBadge = "";
                if (ipcData[currentPeriod] && typeof ipcData[currentPeriod].inflacion === "number") {
                    const infl = ipcData[currentPeriod].inflacion;
                    const sign = infl >= 0 ? "+" : "";
                    ipcBadge = `<span style="font-size:0.7rem; background:rgba(56,189,248,0.15); color:#38bdf8; padding:2px 7px; border-radius:4px; font-weight:700; border:1px solid rgba(56,189,248,0.3); white-space:nowrap;">IPC INDEC: ${sign}${infl.toFixed(1)}%</span>`;
                }

                const periodTotal = series.reduce((acc, s) => acc + (s[dataPointIndex] || 0), 0);

                let rowsHtml = "";
                series.forEach((s, idx) => {
                    const val = s[dataPointIndex] || 0;
                    if (val <= 0 && chartType === "todos") return;
                    const sName = w.globals.seriesNames[idx];
                    const color = w.globals.colors[idx];
                    let diffHtml = "";
                    if (dataPointIndex > 0) {
                        const prevVal = s[dataPointIndex - 1];
                        if (prevVal > 0) {
                            const diff = ((val - prevVal) / prevVal) * 100;
                            const sign = diff >= 0 ? "+" : "";
                            const diffColor = diff > 0 ? "#fb7185" : (diff < 0 ? "#34d399" : "#94a3b8");
                            diffHtml = `<span style="color:${diffColor}; font-size:0.72rem; font-weight:700; margin-left:6px; white-space:nowrap;">(${sign}${diff.toFixed(1)}%)</span>`;
                        }
                    }

                    rowsHtml += `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
                            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                                <span style="width:8px; height:8px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
                                <span style="color:#e2e8f0; font-size:0.76rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sName}</span>
                            </div>
                            <div style="display:flex; align-items:baseline; justify-content:flex-end; white-space:nowrap; flex-shrink:0;">
                                <span style="color:#38bdf8; font-size:0.8rem; font-weight:800; font-variant-numeric:tabular-nums;">${fmt(val)}</span>
                                ${diffHtml}
                            </div>
                        </div>
                    `;
                });

                return `
                    <div style="background:#0f172a !important; border:1px solid rgba(255,255,255,0.18) !important; border-radius:8px !important; padding:10px 14px !important; box-shadow:0 14px 30px rgba(0,0,0,0.85) !important; min-width:320px !important; max-width:440px !important; width:max-content !important; box-sizing:border-box !important;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:6px;">
                            <span style="color:#ffffff; font-size:0.82rem; font-weight:800;">Período ${currentPeriod}</span>
                            ${ipcBadge}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            ${rowsHtml}
                        </div>
                        ${chartType === "todos" && periodTotal > 0 ? `
                            <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.12); display:flex; justify-content:space-between; align-items:center;">
                                <span style="color:#94a3b8; font-size:0.74rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Total Período</span>
                                <span style="color:#ffffff; font-size:0.85rem; font-weight:800; font-variant-numeric:tabular-nums;">${fmtFull(periodTotal)}</span>
                            </div>
                        ` : ""}
                    </div>
                `;
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
        chart: { 
            type: 'donut', 
            height: 230, 
            background: 'transparent', 
            fontFamily: 'Inter, sans-serif' 
        },
        colors,
        stroke: { show: false },
        legend: { show: false },
        dataLabels: { enabled: false },
        plotOptions: { 
            pie: { 
                donut: { 
                    size: '72%', 
                    labels: {
                        show: true,
                        name: { 
                            show: true, 
                            fontSize: '0.85rem', 
                            fontFamily: 'Inter, sans-serif', 
                            fontWeight: 700, 
                            color: '#f8fafc',
                            offsetY: -6
                        },
                        value: { 
                            show: true, 
                            fontSize: '1.15rem', 
                            fontFamily: 'Inter, sans-serif', 
                            fontWeight: 800, 
                            color: '#38bdf8',
                            offsetY: 6,
                            formatter: (val) => fmtFull(Number(val))
                        },
                        total: { 
                            show: true, 
                            showAlways: true, 
                            label: 'Total Gastos', 
                            fontSize: '0.75rem', 
                            fontFamily: 'Inter, sans-serif', 
                            fontWeight: 600, 
                            color: '#94a3b8', 
                            formatter: (w) => {
                                const t = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return fmtFull(t);
                            }
                        }
                    }
                }
            }
        },
        tooltip: { 
            theme: 'dark', 
            fillSeriesColor: false,
            shared: false,
            intersect: true,
            custom: function({ series, seriesIndex, dataPointIndex, w }) {
                const catName = w.globals.labels[seriesIndex];
                const val = series[seriesIndex];
                const total = series.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                const color = w.globals.colors[seriesIndex];
                return `
                    <div style="background:#0f172a !important; border:1px solid rgba(255,255,255,0.18) !important; border-radius:8px !important; padding:8px 12px !important; box-shadow:0 14px 30px rgba(0,0,0,0.85) !important; min-width:210px !important;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px;">
                            <span style="width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
                            <span style="color:#ffffff !important; font-size:0.8rem !important; font-weight:700 !important;">${catName}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:3px;">
                            <span style="color:#cbd5e1 !important; font-size:0.75rem !important; font-weight:500;">Monto período:</span>
                            <span style="color:#38bdf8 !important; font-size:0.85rem !important; font-weight:800;">${fmtFull(val)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">
                            <span style="color:#cbd5e1 !important; font-size:0.75rem !important; font-weight:500;">Participación:</span>
                            <span style="color:#34d399 !important; font-size:0.82rem !important; font-weight:800;">${pct}%</span>
                        </div>
                    </div>
                `;
            }
        }
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
        if (e.empleado) return e.empleado;
        if (c.includes("[encargado titular]")) return "Encargado Permanente";
        if (c.includes("[2° encargado]")) return "Ayudante / Suplente";
        if (c.includes("[personal nocturno]")) return "Vigilancia Nocturna";
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
        if (c.includes("seguridad") || c.includes("mm servicios") || /\bbastida\b/.test(c)) return "Servicios de Seguridad";
        if (c.includes("ascensor") || c.includes("guillemi") || c.includes("gillemi") || c.includes("elevad")) return "Abono Ascensores";
        if (c.includes("plaga") || c.includes("desinsect") || c.includes("desinfecc") || c.includes("fumig") || c.includes("saneamiento")) return "Abono Fumigación";
        if (c.includes("telecentro") || c.includes("flow") || c.includes("cablevision") || c.includes("internet")) return "Conectividad / SUM";
        if (c.includes("ivess") || c.includes("bidon") || c.includes("botellon")) return "Bidones de Agua";
        if (c.includes("correo") || c.includes("carta doc") || c.includes("couceiro")) return "Gastos Postales";
        if (c.includes("cleaning") || c.includes("limpieza")) return "Productos e Insumos Limpieza";
        return "Otros Abonos";
    }

    if (cat === "Mantenimiento y Reparaciones") {
        if (c.includes("pintura") || c.includes("pint") || c.includes("grieta") || c.includes("revoque") || c.includes("albañil") || c.includes("pavon") || c.includes("retapizado") || c.includes("sillon") || c.includes("azotea") || c.includes("impermeab")) return "Pintura, Albañilería y Azotea";
        if (c.includes("ascensor") || c.includes("guillemi") || c.includes("gillemi") || c.includes("acri sergio") || /\bacri\b/.test(c) || c.includes("contrapeso") || c.includes("colizas") || c.includes("frecuencia")) return "Reparación Ascensores";
        if (c.includes("destapac") || c.includes("destap") || c.includes("italoamericana") || c.includes("pozo") || c.includes("paz jorge") || c.includes("cloaca")) return "Destapaciones y Cloacas";
        if (c.includes("plomer") || c.includes("cañer") || c.includes("caño") || c.includes("canilla") || c.includes("sisterna") || c.includes("cisterna") || c.includes("rodriguez") || c.includes("iglesia") || c.includes("rivas") || c.includes("bacha") || c.includes("inodoro") || c.includes("pileta") || c.includes("perdida")) return "Plomería y Cañerías";
        if (c.includes("bomba") || c.includes("presuriz") || c.includes("sanitarios daniel") || c.includes("locatell") || c.includes("locaelli")) return "Bombas de Agua";
        if (c.includes("electric") || c.includes("atila") || c.includes("tablero") || c.includes("disyuntor") || c.includes("lampara") || c.includes("lámpara") || c.includes("lecos") || c.includes("timbre") || c.includes("picaporte") || c.includes("iluminac") || c.includes("combustib") || c.includes("shell") || c.includes("ypf") || c.includes("estacion lido") || c.includes("baterias") || c.includes("bateria") || c.includes("samudio")) return "Electricidad, Iluminación y Combustible";
        if (c.includes("ogaz") || c.includes("floriach") || c.includes("jardin") || c.includes("cesped") || c.includes("césped") || c.includes("cerco")) return "Jardinería y Áreas Verdes";
        if (c.includes("cleaning") || c.includes("cleannig") || c.includes("cleanar") || c.includes("toalla") || c.includes("limpieza") || c.includes("recchia") || c.includes("bolsas") || c.includes("insumos plásticos") || c.includes("zapat") || c.includes("pantalon") || c.includes("de la vega") || c.includes("ropa") || c.includes("adornos") || c.includes("navidad")) return "Productos e Insumos Limpieza";
        if (c.includes("matafuego") || c.includes("protincen") || c.includes("generador") || c.includes("blanco carlos") || c.includes("purpil") || c.includes("escalera")) return "Matafuegos, Generador y Herramientas";
        if (c.includes("combril")) return "Plataforma de Cobranza (Combril)";
        return "Mantenimiento General Edificio";
    }

    if (cat === "Administración") {
        if (c.includes("fernández") || c.includes("fernandez") || c.includes("villasenin")) {
            return "Honorarios Adm. Fernández - Villasenin";
        }
        if (c.includes("consorcio abierto") || c.includes("consorcioabierto")) {
            return "Plataforma ConsorcioAbierto";
        }
        if (c.includes("d&f") || c.includes("d & f") || c.includes("honorarios adm") || c.includes("honorarios de administracion") || c.includes("honorarios administracion")) {
            return "Honorarios Adm. D&F";
        }
        if (c.includes("traspaso") || c.includes("rendicion") || c.includes("incumplimiento")) {
            return "Gastos Traspaso Adm.";
        }
        if (c.includes("pariano") || c.includes("contable") || c.includes("contador") || c.includes("hon0rarios") || c.includes("liquidacion sueldo")) {
            return "Honorarios Contador (Pariano)";
        }
        if (c.includes("fotocop") || c.includes("impresion") || c.includes("librería") || c.includes("libreria") || c.includes("tall graf") || c.includes("sistema") || c.includes("consocli") || c.includes("sipac")) {
            return "Fotocopias / Impresiones";
        }
        if (c.includes("banco") || c.includes("mercado pago") || c.includes("comisión") || c.includes("comision") || c.includes("25413") || c.includes("impuesto") || c.includes("imp ley") || c.includes("paquete")) {
            return "Gastos Bancarios e Impuestos";
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
    const cleanExpenses = [...rawExpenses];
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

    let maxComparisonTotal = 0;
    allPeriods.forEach((_, pIdx) => {
        const pTotal = series.reduce((acc, s) => acc + (s.data[pIdx] || 0), 0);
        if (pTotal > maxComparisonTotal) maxComparisonTotal = pTotal;
    });

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
            max: maxComparisonTotal > 0 ? Math.ceil(maxComparisonTotal * 1.2) : undefined,
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            padding: { top: 18, left: 15, right: 15 }
        },
        annotations: {
            xaxis: [{
                x: '2026-08',
                borderColor: '#22d3ee',
                strokeDashArray: 4,
                label: {
                    borderColor: '#22d3ee',
                    style: { color: '#0f172a', background: '#22d3ee', fontWeight: 700, fontSize: '10px' },
                    text: 'Traspaso Adm. (Ago-26)'
                }
            }]
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', fillSeriesColor: false, y: { formatter: v => fmtFull(v) } }
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
    let cleanExpenses = [...rawExpenses];

    if (categoryName === "Gastos Extraordinarios" && rawExtraordinarios.length > 0) {
        const monthMap = {
            'JULIO': '2025-07', 'JULIO 2025': '2025-07',
            'AGOSTO': '2025-08', 'AGOSTO 2025': '2025-08',
            'SEPTIEMBRE': '2025-09', 'SEPTIEMBRE 2025': '2025-09',
            'OCTUBRE': '2025-10', 'OCTUBRE 2025': '2025-10',
            'NOVIEMBRE': '2025-11', 'NOVIEMBRE 2025': '2025-11',
            'DICIEMBRE': '2025-12', 'DICIEMBRE 2025': '2025-12',
            'ENERO': '2026-01', 'ENERO 2026': '2026-01',
            'FEBRERO': '2026-02', 'FEBRERO 2026': '2026-02',
            'MARZO': '2026-03', 'MARZO 2026': '2026-03',
            'ABRIL': '2026-04', 'ABRIL 2026': '2026-04',
            'MAYO': '2026-05', 'MAYO 2026': '2026-05',
            'JUNIO': '2026-06', 'JUNIO 2026': '2026-06',
            'JULIO 2026': '2026-07',
            'AGOSTO 2026': '2026-08',
            'SEPTIEMBRE 2026': '2026-09'
        };
        const existingKeys = new Set(cleanExpenses.map(e => `${e.periodo}_${Math.round(e.monto)}`));
        rawExtraordinarios.forEach(x => {
            if (x.abonado > 0 && !x.en_gastos_ordinarios_ca) {
                const pRaw = (x.periodo_expensa || '').trim().toUpperCase();
                const p = x.periodo || monthMap[pRaw] || (/^\d{4}-\d{2}$/.test(pRaw) ? pRaw : null);
                if (p && !existingKeys.has(`${p}_${Math.round(x.abonado)}`)) {
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

    let maxPeriodTotal = 0;
    allPeriods.forEach((_, pIdx) => {
        const pTotal = series.reduce((acc, s) => acc + (s.data[pIdx] || 0), 0);
        if (pTotal > maxPeriodTotal) maxPeriodTotal = pTotal;
    });

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 285,
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
            max: maxPeriodTotal > 0 ? Math.ceil(maxPeriodTotal * 1.25) : undefined,
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.03)',
            padding: { top: 18, left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '10px', height: 45 },
        fill: { opacity: 0.95 },
        dataLabels: { enabled: false },
        tooltip: {
            theme: 'dark',
            fillSeriesColor: false,
            shared: false,
            intersect: true,
            custom: function({ series, seriesIndex, dataPointIndex, w }) {
                const pName = w.globals.categoryLabels ? w.globals.categoryLabels[dataPointIndex] : w.globals.labels[dataPointIndex];
                const subcat = w.globals.seriesNames[seriesIndex];
                const val = series[seriesIndex][dataPointIndex];
                const color = w.globals.colors[seriesIndex];
                if (!val || val <= 0) return '';
                return `
                    <div style="background:#0f172a !important; border:1px solid rgba(255,255,255,0.18) !important; border-radius:8px !important; padding:8px 12px !important; box-shadow:0 12px 28px rgba(0,0,0,0.7) !important; min-width:240px !important; max-width:400px !important;">
                        <div style="color:#94a3b8 !important; font-size:0.75rem !important; font-weight:700 !important; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:3px;">
                            ${pName}
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:8px; margin-top:4px;">
                            <span style="width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0; margin-top:4px;"></span>
                            <div style="flex:1;">
                                <div style="color:#ffffff !important; font-size:0.8rem !important; font-weight:700 !important; line-height:1.35 !important; margin-bottom:3px; word-break:normal !important;">
                                    ${subcat}
                                </div>
                                <div style="color:#38bdf8 !important; font-size:0.88rem !important; font-weight:800 !important;">
                                    ${fmtFull(val)}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
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
        { name: 'Encargado Titular (Permanente s/viv.)',     data: sumBy('Encargado Permanente') },
        { name: '2° Encargado y Suplencias',                 data: sumBy('Ayudante / Suplente') },
        { name: 'Cargas Sociales, Sindicato y SAC',          data: sumBy('Cargas Sociales / Sindicato') },
        { name: 'Personal Nocturno Propio',                  data: sumBy('Vigilancia Nocturna') },
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
        tooltip: { theme: 'dark', fillSeriesColor: false, y: { formatter: v => fmtFull(v) } }
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
    if (elVigHist) elVigHist.textContent = 'Acum. histórico: ' + fmt(vnHist) + ' (Rel. Dep. — Liq. Final Sep-26)';
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
        `Mostrando ${total > 0 ? start + 1 : 0}–${end} de ${total.toLocaleString('es-AR')}`;

    // Sort: period desc, amount desc
    const sorted = [...filteredExpenses].sort((a, b) => {
        if (b.periodo !== a.periodo) return b.periodo.localeCompare(a.periodo);
        return b.monto - a.monto;
    });

    const pageItems = sorted.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:2rem;">No se encontraron registros.</td></tr>`;
        renderPagination(pages);
        return;
    }

    tbody.innerHTML = pageItems.map(item => {
        const isSAC = item.concepto.toLowerCase().includes("sac") || item.concepto.toLowerCase().includes("aguinaldo");
        const pp = prevPeriod(item.periodo);
        const pp2 = prevPeriod(pp);

        let prevItem = isSAC ? null : rawExpenses.find(x =>
            x.periodo === pp &&
            matchConcept(x.concepto, item.concepto)
        );
        if (!prevItem && !isSAC && (item.periodo === "2025-11" || semanticFingerprint(item.concepto))) {
            prevItem = rawExpenses.find(x =>
                x.periodo === pp2 &&
                matchConcept(x.concepto, item.concepto)
            );
        }

        let prevMonto = 0, varHtml = `<span class="var-null">—</span>`, diff = 0;
        if (prevItem) {
            prevMonto = prevItem.monto;
            diff = ((item.monto - prevMonto) / prevMonto) * 100;
            const lbTitle = prevItem.periodo !== pp ? ` title="Comparado vs ${prevItem.periodo} (sin PDF ${pp})"` : "";
            const lbTag = prevItem.periodo !== pp ? ` <small style="opacity:0.7;">(vs ${prevItem.periodo.slice(5)})</small>` : "";
            if (diff > 0.5)       varHtml = `<span class="var-up"${lbTitle}>+${diff.toFixed(1)}% ▲${lbTag}</span>`;
            else if (diff < -0.5) varHtml = `<span class="var-down"${lbTitle}>${diff.toFixed(1)}% ▼${lbTag}</span>`;
            else                  varHtml = `<span class="var-null"${lbTitle}>≈ 0%${lbTag}</span>`;
        }

        let badges = [];
        if (item.anomalia) {
            badges.push(`<span class="badge badge-anomalia" title="Desviación +${item.desviacion_pct}% del histórico">Anomalía</span>`);
        }
        
        // Aplica a fijos, abonos o servicios recurrentes que suban >25%
        const catNameLow = (item.categoria || item.rubro).toLowerCase();
        const esRecurrente = item.tipo === "Fijo" || ["servicios públicos", "contratos y abonos", "varios"].includes(catNameLow);
        if (esRecurrente && diff > 25) {
            badges.push(`<span class="badge badge-anomalia" style="background:rgba(251,146,60,0.1); border-color:#fb923c; color:#fb923c;" title="Aumento mayor al 25% respecto al mes anterior">Aumento >25%</span>`);
        }

        const conceptSafe = item.concepto.replace(/'/g, "\'").replace(/"/g, "&quot;");
        const subcat = getSubcategoria(item);
        const showSubcat = subcat && subcat !== item.concepto && subcat !== (item.categoria || item.rubro);

        return `
        <tr>
            <td style="white-space:nowrap; font-weight:600; color:var(--text-2); font-size:0.8rem;">${item.periodo}</td>
            <td>
                <div>${getCatPill(item.categoria || item.rubro)}</div>
                <div style="margin-top:3px; font-size:0.68rem; color:var(--text-3); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">${item.tipo || 'Variable'}</div>
            </td>
            <td class="concepto-cell">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div style="flex:1;">
                        <span class="concepto-title" onclick="openModal('${conceptSafe}')" title="Clic para ver historial completo del concepto">${item.concepto}</span>
                        <div style="display:flex; align-items:center; gap:8px; margin-top:4px; flex-wrap:wrap;">
                            ${showSubcat ? `<span style="font-size:0.73rem; color:var(--text-3); font-weight:500;">${subcat}</span>` : ''}
                            ${item.estado === "Pendiente" ? `<span class="badge badge-pendiente" title="Devengado pendiente de pago">Pendiente</span>` : ''}
                            ${item.seccion === "Pago Parcial" ? `<span class="badge badge-pendiente" title="Pago parcial — Saldo impago: ${fmtFull(item.saldo_pendiente || 0)}">Pago Parcial</span>` : ''}
                            ${badges.join(' ')}
                        </div>
                    </div>
                    <button type="button" onclick="openInvoiceViewerModal('${conceptSafe}', '${item.periodo}', ${item.monto})" title="Ver comprobante respaldatorio de ${item.periodo}" class="btn-factura-cell">Factura</button>
                </div>
            </td>
            <td class="amount-col amount-prev" style="text-align:right; font-variant-numeric:tabular-nums;">${prevMonto > 0 ? fmt(prevMonto) : '—'}</td>
            <td style="text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;">${varHtml}</td>
            <td class="amount-col amount-current" style="text-align:right; font-variant-numeric:tabular-nums; font-weight:800; color:#38bdf8;">${fmt(item.monto)}</td>
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
        const res = await fetch(getRelativeDataUrl("prorrateo.json"));
        const json = await res.json();
        prorrateoData = json.prorrateo || [];
    } catch(e) {
        console.warn("No se pudo cargar prorrateo.json:", e);
    }

    const wb = XLSX.utils.book_new();

    // Hoja 1: Resumen Ejecutivo
    const summaryData = [
        { "Métrica Auditoría": "Total Gastos Auditados en Base", "Valor": rawExpenses.reduce((a,e) => a + (e.monto||0), 0) },
        { "Métrica Auditoría": "Períodos Auditados", "Valor": "14 Meses (Julio 2025 - Septiembre 2026)" },
        { "Métrica Auditoría": "Total Unidades Funcionales", "Valor": "70 UFs (Torres 356, 358 y 360)" },
        { "Métrica Auditoría": "Administración Actual", "Valor": "Fernández - Villasenin (Matr. 862 RPA)" },
        { "Métrica Auditoría": "Plataforma de Gestión", "Valor": "ConsorcioAbierto (ID 27151)" },
        { "Métrica Auditoría": "Cuenta Bancaria Oficial", "Valor": "Banco Galicia CC 0009108-8 044-9 (Alias: SARMIENTO356.58.60)" },
        { "Métrica Auditoría": "Deuda Flotante Regularizada (Ago-26)", "Valor": 15297607.28 },
        { "Métrica Auditoría": "Pasivos Pendientes de Cierre (Sep-26)", "Valor": 3882790.83 },
        { "Métrica Auditoría": "Morosidad Acumulada (Sep-26)", "Valor": 3189720.88 },
        { "Métrica Auditoría": "UFs en Estado de Morosidad (Sep-26)", "Valor": "9 UFs (12,9%)" },
        { "Métrica Auditoría": "Suma Coeficiente de Prorrateo", "Valor": "100.00% (Normalizado ConsorcioAbierto)" },
        { "Métrica Auditoría": "Traspaso de Mandato", "Valor": "Agosto de 2026 (Cese D&F 20/08/2026)" }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 38 }, { wch: 42 }];
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
        "Monto ($)": item.monto,
        "Administración": item.administracion || (item.periodo >= "2026-08" ? "Adm. Fernández - Villasenin" : "D&F Administración")
    }));
    const wsGastos = XLSX.utils.json_to_sheet(dataGastos);
    wsGastos['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 65 }, { wch: 16 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, wsGastos, "Desglose Gastos");

    // Hoja 3: Prorrateo
    if (prorrateoData.length > 0) {
        const dataProrrateo = prorrateoData.map(p => ({
            "Período": p.periodo,
            "UF": p.uf,
            "Depto": p.dpto || p.ubicacion,
            "Propietario": p.propietario,
            "% Copr.": p.porcentual || p.ga_pct,
            "Saldo Ant. ($)": p.saldo_anterior,
            "Pagos ($)": p.pagos,
            "Saldo Mes ($)": p.saldo_mes,
            "Gastos Comunes ($)": p.gastos_comunes || p.ga_monto,
            "Seguridad ($)": p.servicio_seguridad || p.gb_monto,
            "Fondo Reserva ($)": p.fondo_reserva || p.fondo_operativo_monto,
            "Gastos Extra ($)": p.gastos_extraordinarios || p.gastos_extra,
            "Total Mes ($)": p.total_mes,
            "Int. Mora ($)": p.interes_mora || p.interes,
            "Total a Pagar ($)": p.total_a_pagar || p.total
        }));
        const wsProrrateo = XLSX.utils.json_to_sheet(dataProrrateo);
        XLSX.utils.book_append_sheet(wb, wsProrrateo, "Prorrateo 70 UFs");
    }

    // Hoja 4: Morosidad Septiembre 2026
    const sepMoro = rawMorosidadPorPeriodo["2026-09"] || rawMorosidad || [];
    if (sepMoro.length > 0) {
        const dataMoro = sepMoro.map(m => ({
            "Período": "2026-09",
            "UF": m.uf,
            "Ubicación / Depto": m.depto,
            "Consorcista": m.consorcista || `Propietario U.F. ${m.uf}`,
            "Deuda Acumulada ($)": m.deuda
        }));
        const wsMoro = XLSX.utils.json_to_sheet(dataMoro);
        XLSX.utils.book_append_sheet(wb, wsMoro, "Morosidad Sep-26");
    }

    // Hoja 5: Pasivos y Traspaso de Administración
    const pasivosData = [
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "ARCA (Cargas Sociales Julio 2026)", "Comprobante": "2235242956", "Monto ($)": 6206015.70, "Estado": "Cancelado" },
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "BASTIDA S.A. SEGURIDAD PRIVADA", "Comprobante": "0004-00000971", "Monto ($)": 4323293.01, "Estado": "Cancelado" },
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "SUELDOS PERSONAL JULIO 2026", "Comprobante": "Recibos Jul-26", "Monto ($)": 3201690.00, "Estado": "Cancelado" },
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "MARÍA MERCEDES DELJARANO (D&F)", "Comprobante": "0001-00000344/345", "Monto ($)": 914000.00, "Estado": "Cancelado" },
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "SUTERH / FATERYH", "Comprobante": "Jul-26", "Monto ($)": 506408.57, "Estado": "Cancelado" },
        { "Categoría": "Pago Deuda Anterior (Ago-26)", "Proveedor / Concepto": "ASCENSORES GUILLEMI INTERIOR S.A.", "Comprobante": "0002-00026453", "Monto ($)": 146200.00, "Estado": "Cancelado" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "ARCA (Saldo Inicial Cargas Sociales)", "Comprobante": "1663755454", "Monto ($)": 1571590.83, "Estado": "Pendiente (Deuda diferida gestión anterior)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "ARCA (Cargas Sociales Septiembre 2026)", "Comprobante": "Estimado s/acceso", "Monto ($)": 1600000.00, "Estado": "Pendiente (Falta delegación clave fiscal)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "RIVAS MARTÍN CARLOS (Gasto Part. 2°A-356)", "Comprobante": "0001-00000074", "Monto ($)": 290000.00, "Estado": "Pendiente (Reimputado U.F. 7)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "LECOS SERVICIOS (Esteban Linaje)", "Comprobante": "0004-00000427", "Monto ($)": 181000.00, "Estado": "Pendiente (Cámara / Iluminación)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "PARIANO PABLO DAMIÁN (Contador D&F)", "Comprobante": "0002-00001037", "Monto ($)": 175000.00, "Estado": "Pendiente (Saldo en revisión)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "ADM. FERNÁNDEZ - VILLASENIN", "Comprobante": "Hon. Sep-26", "Monto ($)": 70000.00, "Estado": "Pendiente (Saldo parcial)" },
        { "Categoría": "Pasivo Pendiente (Sep-26)", "Proveedor / Concepto": "ASCENSORES GUILLEMI INTERIOR S.A.", "Comprobante": "0002-00026453", "Monto ($)": 200.00, "Estado": "Pendiente (Redondeo Jul-26)" }
    ];
    const wsPasivos = XLSX.utils.json_to_sheet(pasivosData);
    wsPasivos['!cols'] = [{ wch: 30 }, { wch: 42 }, { wch: 22 }, { wch: 16 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsPasivos, "Pasivos y Traspaso");

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

// ── GENERADOR DE RESUMEN EJECUTIVO PARA WHATSAPP ────────────────
const copyWhatsAppSummary = (periodArg) => {
    const selPeriod = periodArg || document.getElementById("periodFilter")?.value || "2026-09";
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    const targetPeriod = (selPeriod === "todos" || !selPeriod) ? allPeriods[allPeriods.length - 1] : selPeriod;

    const bal = rawBalances.find(b => b.periodo === targetPeriod);
    const pExpenses = rawExpenses.filter(e => e.periodo === targetPeriod);
    const egr = (bal && bal.egresos > 0) ? bal.egresos : pExpenses.reduce((a, e) => a + e.monto, 0);
    const ing = (bal && bal.ingresos > 0) ? bal.ingresos : egr * 0.96;
    const delta = ing - egr;
    const pn = bal ? bal.patrimonio_neto : null;

    // Morosidad del período
    const moroList = (rawMorosidadPorPeriodo && rawMorosidadPorPeriodo[targetPeriod])
        ? rawMorosidadPorPeriodo[targetPeriod]
        : (rawMorosidad || []);
    const moroDeuda = moroList.reduce((acc, m) => acc + (m.deuda || 0), 0);
    const maxMoro = moroList.length > 0 ? [...moroList].sort((a,b) => b.deuda - a.deuda)[0] : null;

    // Formatear mensaje WhatsApp
    let msg = `*CONSORCIO SARMIENTO 356-360*\n`;
    msg += `*Resumen Ejecutivo de Expensas — Período: ${targetPeriod}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• *Recaudación Cobrada:* ${fmt(ing)}\n`;
    msg += `• *Gastos Pagados en Caja:* ${fmt(egr)}\n`;
    msg += `• *Resultado Operativo:* ${delta >= 0 ? "Superávit" : "Déficit"} de ${fmt(Math.abs(delta))}\n`;
    if (pn !== null && pn > 0) {
        msg += `• *Saldo Banco / Patrimonio:* ${fmt(pn)}\n`;
    }
    msg += `\n• *Estado de Morosidad (${targetPeriod}):*\n`;
    msg += `• Unidades con Deuda: ${moroList.length} U.F. (${((moroList.length / 70) * 100).toFixed(1)}%)\n`;
    msg += `• Deuda Acumulada Total: ${fmt(moroDeuda)}\n`;
    if (maxMoro) {
        msg += `• Mayor Deuda: UF ${maxMoro.uf} (${formatDpto(maxMoro.depto, maxMoro.uf)}) — ${fmt(maxMoro.deuda)}\n`;
    }
    msg += `\n• *Administración:* ${targetPeriod >= '2026-08' ? 'Fernández - Villasenin (Matr. 862)' : 'D&F Administración'}\n`;
    msg += `• *Plataforma:* ${targetPeriod >= '2026-08' ? 'ConsorcioAbierto' : 'MisExpensas / Tradicional'}\n`;
    msg += `• *Panel de Transparencia & Auditoría:* https://alexismartyniuk.com.ar/sarmiento-360/\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `_Generado automáticamente desde el Panel de Auditoría Independiente._`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(() => {
            showWhatsAppToast("Resumen de " + targetPeriod + " copiado al portapapeles listo para WhatsApp");
        }).catch(err => {
            console.warn("Error copying to clipboard:", err);
            prompt("Copia el siguiente texto para WhatsApp:", msg);
        });
    } else {
        prompt("Copia el siguiente texto para WhatsApp:", msg);
    }
};

const showWhatsAppToast = (text) => {
    let toast = document.getElementById("waToastNotification");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "waToastNotification";
        toast.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:99999;background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:0.75rem 1.25rem;border-radius:10px;font-size:0.85rem;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,0.5);display:flex;align-items:center;gap:8px;transition:opacity 0.3s ease, transform 0.3s ease;opacity:0;transform:translateY(10px);pointer-events:none;";
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
    }, 3000);
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
        const r = await fetch(getRelativeDataUrl("prorrateo.json"));
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
            ? "No se registraron recargos por mora en la base de datos histórica."
            : `En el período ${period} el consorcio no liquidó intereses por mora a ninguna unidad.`;
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
        const r = await fetch(getRelativeDataUrl("prorrateo.json"));
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
        annotations: {
            xaxis: [{
                x: '2026-08',
                borderColor: '#22d3ee',
                strokeDashArray: 4,
                label: {
                    borderColor: '#22d3ee',
                    style: { color: '#0f172a', background: '#22d3ee', fontWeight: 700, fontSize: '10px' },
                    text: 'Traspaso Adm. (Ago-26)'
                }
            }]
        },
        yaxis: { labels: { formatter: v => fmt(v) } },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: { theme: 'dark', fillSeriesColor: false, y: { formatter: v => fmtFull(v) } }
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

    // Proveedores canónicos de Sarmiento 356/358/360 sin colisiones entre rubros
    const targetProviders = [
        { name: "Seguridad Privada (MM / Bastida)", fp: "abono:seguridad_privada", rubro: "Seguridad 24hs" },
        { name: "Honorarios Administración", fp: "adm:honorarios_administracion", rubro: "Honorarios Admin" },
        { name: "Estudio Contable (Pariano)", fp: "adm:estudio_contable_pariano", rubro: "Liquidación Sueldos" },
        { name: "Guillemi (Abono Ascensores)", fp: "abono:ascensores_guillemi", rubro: "Abono Ascensores" },
        { name: "Edesur (Cta. 05637256)", fp: "srv:edesur_05637256", rubro: "Servicio Eléctrico" },
        { name: "AySA Cta 192499 (Torre 358)", fp: "srv:aysa_192499", rubro: "Servicio de Agua" },
        { name: "AySA Cta 192500 (Torre 360)", fp: "srv:aysa_192500", rubro: "Servicio de Agua" },
        { name: "La Holando (Seguro Integral)", fp: "seguro:holando_integral", rubro: "Seguro Consorcio" },
        { name: "Allianz (Seguro Personal / AP)", fp: "seguro:allianz_personal", rubro: "Seguro Personal" },
        { name: "Conectividad (Flow / Telecentro)", fp: "abono:internet_consorcio", rubro: "Internet Consorcio" },
        { name: "FB Saneamiento (Fumigación)", fp: "abono:fumigacion_fb", rubro: "Desinsectación" },
        { name: "Plataforma ConsorcioAbierto", fp: "adm:plataforma_consorcioabierto", rubro: "Sistema Gestión" }
    ];

    let rowsHtml = "";
    const ipcActual = ipcData[targetPeriod]?.valor;

    targetProviders.forEach(p => {
        const matchesFp = (e) => semanticFingerprint(e.concepto) === p.fp;
        const actualExpense = rawExpenses.find(e => e.periodo === targetPeriod && matchesFp(e));
        let prevExpense = rawExpenses.find(e => e.periodo === prevPeriod && matchesFp(e));

        // Fallback: primera factura histórica anterior al período evaluado
        if (!prevExpense && actualExpense) {
            prevExpense = rawExpenses.find(e => e.periodo < targetPeriod && matchesFp(e));
        }

        if (actualExpense) {
            const refPeriod = prevExpense ? prevExpense.periodo : prevPeriod;
            const ipcRef = ipcData[refPeriod]?.valor;
            const ipcAcum = (ipcActual && ipcRef) ? ((ipcActual - ipcRef) / ipcRef) * 100 : null;
            const ipcText = ipcAcum !== null ? `${ipcAcum.toFixed(1)}%` : "N/D";

            const varPct = prevExpense ? ((actualExpense.monto - prevExpense.monto) / prevExpense.monto) * 100 : 0;

            let badge = `<span class="badge badge-success">Estable</span>`;
            if (ipcAcum !== null && prevExpense) {
                if (varPct > ipcAcum + 25) {
                    badge = `<span class="badge badge-danger">Excesivo (> IPC + 25%)</span>`;
                } else if (varPct > ipcAcum + 5) {
                    badge = `<span class="badge badge-warning">Alto (> IPC)</span>`;
                }
            }

            let diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">N/D</td>`;
            if (ipcAcum !== null && prevExpense) {
                const expected = prevExpense.monto * (1 + (ipcAcum / 100));
                const diffValue = actualExpense.monto - expected;
                const diffFmt = fmt(Math.abs(diffValue));
                if (diffValue > 50) {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #f43f5e; font-weight: 700; font-size: 0.85rem;">+${diffFmt}</td>`;
                } else if (diffValue < -50) {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #10b981; font-weight: 700; font-size: 0.85rem;">-${diffFmt}</td>`;
                } else {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">$0</td>`;
                }
            }

            const prevLabel = prevExpense ? `${fmt(prevExpense.monto)} <span style="font-size:0.7rem;opacity:0.75;">(${prevExpense.periodo})</span>` : 'Sin antecedente';

            rowsHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.75rem 0.5rem; text-align: left; font-weight: 600; color: var(--text-2);">${p.name}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: left; color: var(--text-3); font-size: 0.8rem;">${p.rubro}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: var(--text-1);">${fmt(actualExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3);">${prevLabel}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: ${ipcAcum !== null && varPct > ipcAcum ? '#f43f5e' : '#10b981'};">${prevExpense ? varPct.toFixed(1) + '%' : '—'}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-2); font-weight: 500;">${prevExpense ? ipcText : '—'}</td>
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
                    return `<span class="badge badge-warning" style="white-space: nowrap;">Alerta</span>`;
                }
                return `<span class="badge badge-success" style="white-space: nowrap;">Normal</span>`;
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
                        <span style="color: var(--text-2);">Luz (Edesur)</span>
                        ${getBadge(edesur)}
                    </div>
                    ${getMessageHtml(edesur)}
                </div>

                <!-- AYSA -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">Agua (AySA)</span>
                        ${getBadge(aysa)}
                    </div>
                    ${getMessageHtml(aysa)}
                </div>

                <!-- METROGAS -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">Gas (Metrogas)</span>
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

    const totLiq = rawExtraordinarios.reduce((a, x) => a + Number(x.liquidado || 0), 0);
    const totRec = rawExtraordinarios.reduce((a, x) => a + Number(x.recaudado || 0), 0);
    const totAbo = rawExtraordinarios.reduce((a, x) => a + Number(x.abonado || 0), 0);
    const totSal = totRec - totAbo;

    const elLiq = document.getElementById("extraLiquidado");
    const elRec = document.getElementById("extraRecaudado");
    const elAbo = document.getElementById("extraAbonado");
    const elSal = document.getElementById("extraSaldo");
    if (elLiq) elLiq.textContent = fmt(totLiq);
    if (elRec) elRec.textContent = fmt(totRec);
    if (elAbo) elAbo.textContent = fmt(totAbo);
    if (elSal) {
        elSal.textContent = totSal < 0 ? `-${fmt(Math.abs(totSal))}` : fmt(totSal);
        elSal.style.color = totSal < 0 ? "#f43f5e" : "#10b981";
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
const renderMorosidad = (period) => {
    const tbody = document.getElementById("morosidadTableBody");
    if (!tbody) return;

    const availablePeriods = Object.keys(rawMorosidadPorPeriodo || {}).sort();
    let activePeriod = period;

    if (!activePeriod || activePeriod === "todos" || !rawMorosidadPorPeriodo[activePeriod]) {
        // Por defecto usar el período más reciente con morosidad
        activePeriod = availablePeriods.length > 0 ? availablePeriods[availablePeriods.length - 1] : "2026-09";
    }

    const moroList = (rawMorosidadPorPeriodo && rawMorosidadPorPeriodo[activePeriod])
        ? [...rawMorosidadPorPeriodo[activePeriod]]
        : (rawMorosidad && rawMorosidad.length > 0 ? [...rawMorosidad] : []);

    const badgeHeaderEl = document.getElementById("moroBadgeHeader");
    if (badgeHeaderEl) {
        badgeHeaderEl.textContent = `${moroList.length} U.F. en Morosidad (${activePeriod})`;
    }

    const moroCardTitleEl = document.querySelector("#morosidad .card-title");
    if (moroCardTitleEl) {
        moroCardTitleEl.textContent = `Estado de Morosidad de Propietarios — Período ${activePeriod}`;
    }

    if (moroList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:1.5rem;">Sin registros de morosidad para el período ${activePeriod}.</td></tr>`;
        const moroCountEl = document.getElementById("moroCount");
        if (moroCountEl) moroCountEl.textContent = "0 U.F. (0,0%)";
        const moroTotalDeudaEl = document.getElementById("moroTotalDeuda");
        if (moroTotalDeudaEl) moroTotalDeudaEl.textContent = "$ 0,00";
        return;
    }

    moroList.sort((a, b) => b.deuda - a.deuda);

    const totalDeuda = moroList.reduce((acc, m) => acc + m.deuda, 0);
    const maxMoro = moroList[0];
    const avgDeuda = totalDeuda / moroList.length;

    const moroCountEl = document.getElementById("moroCount");
    if (moroCountEl) moroCountEl.textContent = `${moroList.length} U.F. (${((moroList.length / 70) * 100).toFixed(1)}%)`;

    const moroTotalDeudaEl = document.getElementById("moroTotalDeuda");
    if (moroTotalDeudaEl) moroTotalDeudaEl.textContent = fmtFull(totalDeuda);

    const moroMaxDeudaEl = document.getElementById("moroMaxDeuda");
    if (moroMaxDeudaEl) moroMaxDeudaEl.textContent = fmtFull(maxMoro.deuda);

    const moroMaxOwnerEl = document.getElementById("moroMaxOwner");
    if (moroMaxOwnerEl) {
        const cleanDept = formatDpto(maxMoro.depto, maxMoro.uf);
        moroMaxOwnerEl.textContent = `UF ${maxMoro.uf} (${cleanDept})`;
    }

    const moroAvgDeudaEl = document.getElementById("moroAvgDeuda");
    if (moroAvgDeudaEl) moroAvgDeudaEl.textContent = fmtFull(avgDeuda);

    let html = "";
    moroList.forEach(item => {
        const badgeStr = item.deuda > 300000 
            ? '<span class="badge badge-danger">Moroso Crítico</span>' 
            : (item.deuda > 100000 ? '<span class="badge badge-warning">Con Deuda</span>' : '<span class="badge badge-warning" style="opacity:0.8">Saldo Menor</span>');

        const cleanDept = formatDpto(item.depto, item.uf);
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
                        Ver U.F.
                    </a>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
};

// ── INIT APP (INGESTA DE DATOS) ──────────────────────────────────
const init = async () => {
    // Iniciar carga de IPC (esperada para tablas comparativas) y Auditoría Forense
    await fetchIPC();
    loadForensicAudit();

    try {
        const response = await fetch(getRelativeDataUrl("gastos.json"));
        const data = await response.json();
        
        rawExpenses = (data.gastos || []).filter(e => e.monto > 0);
        rawBalances = data.balances || [];
        rawMultas   = data.multas || [];
        rawExtraordinarios = data.gastos_extraordinarios || data.extraordinarios || [];
        rawMorosidad = data.morosidad || [];
        rawMorosidadPorPeriodo = data.morosidad_por_periodo || {};
        consorcioMeta = data.consorcio_meta || {};

        // Calcular anomalías cuantitativas con media móvil sobre huella semántica unificada
        rawExpenses.sort((a, b) => a.periodo.localeCompare(b.periodo));
        const history = {};
        rawExpenses.forEach(e => {
            const key = semanticFingerprint(e.concepto) || e.concepto.toLowerCase().slice(0, 30);
            const prev = history[key] || [];
            const cu = e.concepto.toUpperCase();
            const isSAC = cu.includes("SAC") || cu.includes("FINAL") || cu.includes("DIAS NO TRABAJADOS");
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
        try { renderContractsBoard(); } catch(e) { console.warn("Error en renderContractsBoard:", e); }
        try { loadServicesStatus(); } catch(e) { console.warn("Error en loadServicesStatus:", e); }
    } catch (error) {
        console.error("Error al cargar los datos de expensas:", error);
    }
};

// ── TABLERO DE CONTRATOS E INSPECCIONES ────────────────────────────
const renderContractsBoard = () => {
    const container = document.getElementById("contractsBoardContainer");
    if (!container) return;

    const contracts = [
        {
            title: "Administración de Consorcios",
            provider: "Fernández - Villasenin (RPAC Matr. 862)",
            type: "Administración Legal y Contable (Ley 14.701 PBA)",
            dueDate: "2027-08-01",
            cost: "$ 830.000 /mes",
            status: "Vigente"
        },
        {
            title: "Seguridad Privada 24 hs",
            provider: "Bastida S.A. Seguridad Privada Integral",
            type: "Vigilancia Física Diurna y Nocturna (Sarmiento 356-360)",
            dueDate: "2027-03-31",
            cost: "$ 4.948.100 /mes",
            status: "Vigente"
        },
        {
            title: "Plataforma de Gestión Digital",
            provider: "Consorcio Abierto S.R.L.",
            type: "Portal de Propietarios y Liquidación Online (70 UFs)",
            dueDate: "2027-08-01",
            cost: "$ 66.193 /mes",
            status: "Vigente"
        },
        {
            title: "Seguro Integral + Accidentes Personales",
            provider: "La Holando Sudamericana + Allianz",
            type: "Póliza Integral N° 2000004.5 + Póliza AP",
            dueDate: "2027-06-30",
            cost: "$ 357.462 /mes",
            status: "Vigente"
        },
        {
            title: "Abono Conservación de Ascensores",
            provider: "Ascensores Guillemi Interior S.A.",
            type: "Mantenimiento Preventivo (Torres 356, 358 y 360)",
            dueDate: "2026-12-01",
            cost: "$ 146.400 /mes",
            status: "Vigente"
        },
        {
            title: "Desinfección y Control de Plagas",
            provider: "FB Saneamiento Ambiental",
            type: "Servicio de Desinsectación en Partes Comunes",
            dueDate: "2026-12-15",
            cost: "$ 130.000 /mes",
            status: "Vigente"
        },
        {
            title: "Reparación y Pintura Contrafrente",
            provider: "Luis de la Paz Pavón Riveros",
            type: "Obra Extraordinaria Fondo de Reserva (Fc. C 0005-00136)",
            dueDate: "2026-08-31",
            cost: "$ 2.000.000 (Cierre Ago-26)",
            status: "Finalizada"
        }
    ];

    const today = new Date();

    const html = contracts.map(c => {
        const parts = c.dueDate.split("-");
        const due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let badgeClass = "badge-success";
        let badgeText = `${diffDays} días restantes`;
        if (diffDays <= 15) {
            badgeClass = "badge-danger";
            badgeText = `Vence en ${diffDays} días`;
        } else if (diffDays <= 45) {
            badgeClass = "badge-warning";
            badgeText = `Vence en ${diffDays} días`;
        }

        return `
            <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:1rem; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-weight:700; font-size:0.95rem; color:var(--text-1);">${c.title}</div>
                        <div style="font-size:0.8rem; color:var(--accent); font-weight:600;">${c.provider}</div>
                    </div>
                    <span class="badge ${badgeClass}" style="font-size:0.7rem;">${badgeText}</span>
                </div>
                <div style="font-size:0.78rem; color:var(--text-3); display:flex; justify-content:space-between; align-items:center; border-top:1px dashed rgba(255,255,255,0.05); padding-top:8px;">
                    <span>${c.type}</span>
                    <strong style="color:var(--text-1);">${c.cost}</strong>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = html;
};

// ── EXPORTADORES A EXCEL (XLSX) ──────────────────────────────────
const exportExpensesToExcel = () => {
    if (typeof XLSX === 'undefined') {
        alert("La librería XLSX no está disponible.");
        return;
    }
    if (!rawExpenses || rawExpenses.length === 0) {
        alert("No hay datos de gastos para exportar.");
        return;
    }

    const exportData = rawExpenses.map(e => ({
        "Período": e.periodo,
        "Categoría": e.categoria || e.rubro || 'General',
        "Concepto": e.concepto,
        "Monto ($ ARS)": e.monto,
        "Tipo": e.tipo || 'Fijo',
        "Estado": e.estado || 'Pagado',
        "Anomalía": e.anomalia ? 'Sí' : 'No'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gastos Historicos");
    XLSX.writeFile(wb, "Sarmiento360_Gastos_Historicos.xlsx");
};

const exportMorosidadToExcel = () => {
    if (typeof XLSX === 'undefined') {
        alert("La librería XLSX no está disponible.");
        return;
    }
    const selPeriod = document.getElementById("periodFilter")?.value;
    const availPeriods = Object.keys(rawMorosidadPorPeriodo || {}).sort();
    const activePeriod = (selPeriod && selPeriod !== "todos" && rawMorosidadPorPeriodo[selPeriod])
        ? selPeriod
        : (availPeriods.length > 0 ? availPeriods[availPeriods.length - 1] : "2026-09");
    const sourceList = (rawMorosidadPorPeriodo && rawMorosidadPorPeriodo[activePeriod])
        ? rawMorosidadPorPeriodo[activePeriod]
        : (rawMorosidad || []);

    if (!sourceList || sourceList.length === 0) {
        alert("No hay datos de morosidad para exportar.");
        return;
    }

    const exportData = sourceList.map(m => ({
        "U.F. #": m.uf,
        "Ubicación": formatDpto(m.depto, m.uf),
        "Propietario": `Propietario U.F. ${m.uf}`,
        "Deuda Acumulada ($ ARS)": m.deuda,
        "Período": m.periodo || activePeriod
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estado Morosidad");
    XLSX.writeFile(wb, `Sarmiento360_Estado_Morosidad_${activePeriod}.xlsx`);
};

document.addEventListener("DOMContentLoaded", init);





// =========================================================================
// MÓDULO FORENSE Y GENERADOR INTERACTIVO DE RECLAMOS (SARMIENTO 360)
// =========================================================================
let forensicAuditData = null;

const loadForensicAudit = async () => {
    try {
        const r = await fetch(getRelativeDataUrl("forensic_audit.json"));
        if (r.ok) {
            forensicAuditData = await r.json();
            const fUnits = forensicAuditData?.auditoria_seguridad_70_ufs?.unidades || [];
            fUnits.forEach(u => {
                if (u.uf && u.dpto) canonicalUfDptoMap[Number(u.uf)] = u.dpto;
            });
            renderForensicAuditTables();
            if (rawMorosidad && (rawMorosidad.length > 0 || Object.keys(rawMorosidadPorPeriodo || {}).length > 0)) {
                renderMorosidad(document.getElementById("periodFilter")?.value);
            }
        }
    } catch (e) {
        console.error("Error al cargar forensic_audit.json:", e);
    }
};

const renderForensicAuditTables = () => {
    if (!forensicAuditData) return;

    // 1. Tabla de Conciliación Bancaria (Caja vs. Banco Galicia)
    const concilBody = document.getElementById("conciliacionTableBody");
    if (concilBody && forensicAuditData.conciliacion_bancaria) {
        const res = forensicAuditData.conciliacion_bancaria.resumen || {};
        const elProrr = document.getElementById("concilKpiProrr");
        const elBanco = document.getElementById("concilKpiBanco");
        const elBrecha = document.getElementById("concilKpiBrecha");
        const elBadge = document.getElementById("concilBadgeHeader");
        if (elProrr && res.total_recaudado_prorrateo) elProrr.textContent = `$${formatMoney(res.total_recaudado_prorrateo)}`;
        if (elBanco && res.total_ingresos_banco) elBanco.textContent = `$${formatMoney(res.total_ingresos_banco)}`;
        if (elBrecha && typeof res.brecha_positiva_gestion_anterior === "number") elBrecha.textContent = `+$${formatMoney(res.brecha_positiva_gestion_anterior)}`;
        if (elBadge && typeof res.brecha_positiva_gestion_anterior === "number") elBadge.textContent = `Brecha Meses Deficitarios D&F: +$${formatMoney(res.brecha_positiva_gestion_anterior)}`;

        const rows = forensicAuditData.conciliacion_bancaria.periodos || [];
        concilBody.innerHTML = rows.map(r => {
            const isAlert = r.periodo <= "2026-07" && r.diferencia_caja > 500000;
            const diffColor = isAlert ? "#f43f5e" : (r.diferencia_caja < -1000 ? "#34d399" : "var(--text-1)");
            const badgeClass = isAlert ? "badge-danger" : (r.diferencia_caja < -1000 ? "badge-success" : "badge-info");
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 8px 10px; font-weight: 700; color: var(--text-1);">${r.periodo}</td>
                    <td style="padding: 8px 10px; text-align: right; color: #38bdf8; font-variant-numeric: tabular-nums;">$ ${formatMoney(r.recaudado_prorrateo)}</td>
                    <td style="padding: 8px 10px; text-align: right; color: #34d399; font-variant-numeric: tabular-nums;">$ ${formatMoney(r.ingresos_banco)}</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: ${diffColor}; font-variant-numeric: tabular-nums;">$ ${formatMoney(r.diferencia_caja)}</td>
                    <td style="padding: 8px 10px;">
                        <span class="badge ${badgeClass}" style="font-size: 0.7rem;">${r.observacion}</span>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // 2. Tabla de Integridad de Porcentuales
    const integrBody = document.getElementById("integridadTableBody");
    if (integrBody && forensicAuditData.integridad_porcentuales) {
        const rows = forensicAuditData.integridad_porcentuales.periodos || [];
        integrBody.innerHTML = rows.map(r => {
            const hasGap = Math.abs(r.desvio_legal_pct) > 0.02;
            const gapColor = hasGap ? "#f43f5e" : "#34d399";
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 8px 10px; font-weight: 700; color: var(--text-1);">${r.periodo}</td>
                    <td style="padding: 8px 10px; text-align: center; color: var(--text-2);">${r.total_unidades} UFs</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: var(--text-1); font-variant-numeric: tabular-nums;">${r.sum_porcentual_legal.toFixed(4)}%</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: ${gapColor}; font-variant-numeric: tabular-nums;">${r.desvio_legal_pct !== 0 ? `-${r.desvio_legal_pct.toFixed(4)}%` : "0,0000%"}</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: #fb7185; font-variant-numeric: tabular-nums;">${r.sum_gb_seguridad_pct.toFixed(4)}%</td>
                    <td style="padding: 8px 10px;">
                        ${hasGap ? 
                            '<span class="badge badge-danger" style="font-size: 0.68rem;">Faltante Coef. (0,21%) + Cobro Plano 1/70 Ilegal</span>' : 
                            '<span class="badge badge-warning" style="font-size: 0.68rem;">Coeficiente Regularizado (~100%) · Seguridad Plana 1/70</span>'
                        }
                    </td>
                </tr>
            `;
        }).join("");
    }

    // 3. Tabla de Proveedores vs. Inflación INDEC
    const provIpcBody = document.getElementById("proveedoresIpcTableBody");
    if (provIpcBody && forensicAuditData.auditoria_proveedores_vs_ipc) {
        const rows = forensicAuditData.auditoria_proveedores_vs_ipc.proveedores || [];
        provIpcBody.innerHTML = rows.map(r => {
            const isOver = r.desvio_vs_ipc_pct > 15;
            const desvioColor = isOver ? "#f43f5e" : (r.desvio_vs_ipc_pct < -15 ? "#34d399" : "#fbbf24");
            const badgeClass = isOver ? "badge-danger" : (r.desvio_vs_ipc_pct < -15 ? "badge-success" : "badge-warning");
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 8px 10px; font-weight: 700; color: var(--text-1);">${r.proveedor} <span style="font-size:0.7rem;color:var(--text-3);font-weight:500;">(${r.periodo_inicio} → ${r.periodo_fin})</span></td>
                    <td style="padding: 8px 10px; text-align: right; color: var(--text-3); font-variant-numeric: tabular-nums;">$ ${formatMoney(r.monto_inicial)}</td>
                    <td style="padding: 8px 10px; text-align: right; color: var(--text-1); font-weight: 600; font-variant-numeric: tabular-nums;">$ ${formatMoney(r.monto_final)}</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums;">+${r.aumento_acumulado_pct.toFixed(1)}%</td>
                    <td style="padding: 8px 10px; text-align: right; color: #a78bfa; font-variant-numeric: tabular-nums;">+${r.inflacion_ipc_pct.toFixed(1)}%</td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 800; color: ${desvioColor}; font-variant-numeric: tabular-nums;">${r.desvio_vs_ipc_pct > 0 ? `+${r.desvio_vs_ipc_pct.toFixed(1)}%` : `${r.desvio_vs_ipc_pct.toFixed(1)}%`}</td>
                    <td style="padding: 8px 10px;">
                        <span class="badge ${badgeClass}" style="font-size: 0.7rem;">${r.evaluacion}</span>
                    </td>
                </tr>
            `;
        }).join("");
    }
};



// ── TOOLTIP COLLISION & BOUNDARY CLAMP (ANTI-SOLAPAMIENTO Y ANTI-OVERFLOW) ──
(function initApexTooltipClamp() {
    let ticking = false;

    function clampTooltips() {
        ticking = false;
        const activeTooltips = document.querySelectorAll('.apexcharts-tooltip.apexcharts-active');
        if (!activeTooltips.length) return;

        activeTooltips.forEach(tt => {
            const card = tt.closest('.card') || tt.closest('.kpi-card') || tt.closest('.chart-card') || tt.closest('.apexcharts-canvas');
            if (!card) return;

            const cardRect = card.getBoundingClientRect();
            const ttRect = tt.getBoundingClientRect();
            if (ttRect.width === 0 || ttRect.height === 0) return;

            // 1. Evitar solapamiento vertical con el encabezado de la tarjeta (.card-header)
            const header = card.querySelector('.card-header');
            const minAllowedTop = header ? header.getBoundingClientRect().bottom + 6 : cardRect.top + 10;
            if (ttRect.top < minAllowedTop) {
                const diff = minAllowedTop - ttRect.top;
                const currentTop = parseFloat(tt.style.top) || 0;
                tt.style.top = (currentTop + diff) + 'px';
            }

            // 2. Evitar desborde horizontal hacia la tarjeta contigua derecha
            const maxAllowedRight = cardRect.right - 14;
            if (ttRect.right > maxAllowedRight) {
                const diff = ttRect.right - maxAllowedRight;
                const currentLeft = parseFloat(tt.style.left) || 0;
                tt.style.left = Math.max(8, currentLeft - diff) + 'px';
            }

            // 3. Evitar recorte en el margen izquierdo
            const minAllowedLeft = cardRect.left + 14;
            if (ttRect.left < minAllowedLeft) {
                const diff = minAllowedLeft - ttRect.left;
                const currentLeft = parseFloat(tt.style.left) || 0;
                tt.style.left = (currentLeft + diff) + 'px';
            }
        });
    }

    window.addEventListener('pointermove', () => {
        if (!ticking) {
            window.requestAnimationFrame(clampTooltips);
            ticking = true;
        }
    }, { passive: true });

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(clampTooltips);
            ticking = true;
        }
    }, { passive: true });
})();


// =========================================================================
// SISTEMA DE NAVEGACIÓN MODULAR Y PROGRESSIVE DISCLOSURE
// =========================================================================
const MODULE_HASH_MAP = {
    'overview': 'view-overview',
    'resumen': 'view-overview',
    'analytics': 'view-analytics',
    'graficos': 'view-analytics',
    'tendencias': 'view-analytics',
    'operaciones': 'view-operations',
    'gastos': 'view-operations',
    'tabla': 'view-operations',
    'comprobantes': 'view-operations',
    'diagnostico': 'view-diagnostics',
    'diagnostics': 'view-diagnostics',
    'auditoria': 'view-diagnostics',
    'pericia': 'view-diagnostics',
    'reclamo': 'view-diagnostics',
    'morosidad': 'view-diagnostics',
    'asambleas': 'view-events',
    'eventos': 'view-events',
    'actas': 'view-events',
    'novedades': 'view-events',
    'normativa': 'view-config',
    'config': 'view-config',
    'legal': 'view-config',
    'reglamentos': 'view-config'
};

window.navigateToModule = function(targetViewId, targetAnchorId) {
    const views = document.querySelectorAll('.module-view');
    let found = false;

    views.forEach(v => {
        if (v.id === targetViewId) {
            v.classList.add('active');
            found = true;
        } else {
            v.classList.remove('active');
        }
    });

    if (!found) {
        const def = document.getElementById('view-overview');
        if (def) def.classList.add('active');
        targetViewId = 'view-overview';
    }

    // Actualizar sidebar nav items
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
        const btnTarget = btn.getAttribute('data-target-view');
        if (btnTarget) {
            btn.classList.toggle('active', btnTarget === targetViewId);
        }
    });

    // Actualizar URL hash sin salto de página brusco
    const cleanHash = targetViewId.replace('view-', '');
    if (window.location.hash !== '#' + cleanHash) {
        history.replaceState(null, '', '#' + cleanHash);
    }

    // Scroll contextual
    if (targetAnchorId) {
        setTimeout(() => {
            const el = document.getElementById(targetAnchorId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 120);
    } else {
        const mainEl = document.querySelector('.main');
        if (mainEl) mainEl.scrollTop = 0;
    }

    // Disparar evento de resize para recalcular anchos de ApexCharts
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
};

function initModularNavigation() {
    // 1. Manejo de Sidebar Toggle (Colapso / Expansión 240px <-> 72px)
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('appSidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            try {
                localStorage.setItem('sarmiento_sidebar_collapsed', isCollapsed ? '1' : '0');
            } catch(e) {}
            window.dispatchEvent(new Event('resize'));
            setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
        });

        // Restaurar preferencia guardada
        try {
            if (localStorage.getItem('sarmiento_sidebar_collapsed') === '1') {
                sidebar.classList.add('collapsed');
            }
        } catch(e) {}
    }

    // 2. Resolver Hash inicial
    function handleHashRouting() {
        const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
        let targetView = MODULE_HASH_MAP[rawHash];
        let targetAnchor = null;

        if (!targetView) {
            if (rawHash.startsWith('asamblea')) {
                targetView = 'view-events';
                targetAnchor = rawHash;
            } else if (rawHash === 'empleados' || rawHash === 'extraordinarios') {
                targetView = 'view-operations';
                targetAnchor = rawHash;
            } else if (rawHash === 'secauditoriadocumental' || rawHash === 'secley14701' || rawHash === 'reglamentos') {
                targetView = 'view-config';
                targetAnchor = rawHash;
            } else {
                targetView = 'view-overview';
            }
        }
        window.navigateToModule(targetView, targetAnchor);
    }

    window.addEventListener('hashchange', handleHashRouting);
    handleHashRouting();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModularNavigation);
} else {
    initModularNavigation();
}


// ── NAVEGACIÓN Y FILTRO DE ASAMBLEAS ─────────────────────────────
window.filterAssemblyView = function(targetId) {
    const cards = ['asamblea-2026-11-02', 'asamblea-2013-09-16', 'asamblea-2012-09-05', 'novedades'];
    cards.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (targetId === 'all') {
                el.style.display = '';
            } else if (id === targetId) {
                el.style.display = '';
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                el.style.display = 'none';
            }
        }
    });

    const btnAll = document.getElementById('btnFilterAssemblyAll');
    const btn2026 = document.getElementById('btnFilterAssembly2026');
    const btn2013 = document.getElementById('btnFilterAssembly2013');
    const btn2012 = document.getElementById('btnFilterAssembly2012');
    const btnNov = document.getElementById('btnFilterAssemblyNovedades');

    const resetBtn = (btn) => {
        if (!btn) return;
        btn.style.background = 'rgba(255,255,255,0.05)';
        btn.style.color = 'var(--text-2)';
        btn.style.borderColor = 'var(--border)';
    };
    [btnAll, btn2026, btn2013, btn2012, btnNov].forEach(resetBtn);

    const activeBtn = targetId === 'all' ? btnAll :
                      targetId === 'asamblea-2026-11-02' ? btn2026 :
                      targetId === 'asamblea-2013-09-16' ? btn2013 :
                      targetId === 'asamblea-2012-09-05' ? btn2012 : btnNov;
    if (activeBtn) {
        activeBtn.style.background = 'var(--accent)';
        activeBtn.style.color = '#fff';
        activeBtn.style.borderColor = 'transparent';
    }
};

window.navigateToAssembly = function(assemblyId) {
    navigateToModule('view-events');
    window.filterAssemblyView('all');
    setTimeout(() => {
        const el = document.getElementById(assemblyId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
            el.style.borderColor = 'rgba(56, 189, 248, 0.8)';
            el.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.3)';
            setTimeout(() => {
                el.style.borderColor = '';
                el.style.boxShadow = '';
            }, 2500);
        }
    }, 150);
};
