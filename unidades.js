// Dashboard de Unidades Funcionales (U.F.) — Sarmiento 360
// ─────────────────────────────────────────────────────────────

// Helper para resolver archivos JSON relativos sin importar si la URL tiene slash final o no
const getRelativeDataUrl = (file) => {
    let path = window.location.pathname;
    if (!path.endsWith("/") && !path.endsWith(".html")) {
        path += "/";
    }
    return new URL(file, window.location.origin + path).href;
};

let rawProrrateo = [];
let rawGastos = [];
let filteredProrrateo = [];

// Chart instances
let chartMorosity = null;
let chartCaja = null;
let chartUfHistory = null;

// Formatters
const fmt = (n) => {
    const val = Number(n);
    if (isNaN(val)) return '$ 0';
    return new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(val);
};

const fmtFull = (n) => {
    const val = Number(n);
    if (isNaN(val)) return '$ 0,00';
    return new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(val);
};

// ── BOOTSTRAP ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    Promise.all([
        fetch(getRelativeDataUrl("prorrateo.json")).then(r => r.json()).catch(() => ({ prorrateo: [] })),
        fetch(getRelativeDataUrl("gastos.json")).then(r => r.json()).catch(() => ({ gastos: [] }))
    ]).then(([prorrateoData, gastosData]) => {
        rawGastos = gastosData.gastos || [];
        const allProrrateo = prorrateoData.prorrateo || [];
            if (allProrrateo.length > 0) {
                rawProrrateo = allProrrateo.map(item => {
                    const saldoAnt = Number(item.saldo_anterior || 0);
                    const pagosVal = Number(item.pagos || 0);
                    const saldoVal = item.saldo !== undefined && !isNaN(Number(item.saldo)) ? Number(item.saldo) : (item.saldo_mes !== undefined && !isNaN(Number(item.saldo_mes)) ? Number(item.saldo_mes) : (saldoAnt - pagosVal));
                    const deudaVal = item.deuda !== undefined && !isNaN(Number(item.deuda)) ? Number(item.deuda) : (saldoVal > 0 ? saldoVal : 0);

                    return {
                        ...item,
                        saldo_anterior: isNaN(saldoAnt) ? 0 : saldoAnt,
                        pagos: isNaN(pagosVal) ? 0 : pagosVal,
                        saldo_mes: isNaN(saldoVal) ? 0 : saldoVal,
                        deuda: isNaN(deudaVal) ? 0 : deudaVal,
                        ga_monto: Number(item.ga_monto || item.gastos_comunes || 0),
                        gb_monto: Number(item.gb_monto || item.servicio_seguridad || 0),
                        fondo_operativo_monto: Number(item.fondo_operativo_monto || item.fondo_reserva || 0),
                        gastos_extra: Number(item.gastos_extra || item.gastos_extraordinarios || 0),
                        red_ajustes: Number(item.red_ajustes || item.eventual || 0),
                        interes: Number(item.interes || item.interes_mora || 0),
                        total: Number(item.total || item.total_a_pagar || item.total_mes || 0)
                    };
                });
                rawProrrateo.sort((a, b) => a.periodo.localeCompare(b.periodo));
            } else {
                rawProrrateo = [];
            }
            
            populatePeriodFilter();
            setupEventListeners();
            applyFilter();
            loadServicesStatus();
        })
        .catch(err => {
            console.error("Error loading prorrateo.json:", err);
            document.getElementById("prorrateoTableBody").innerHTML =
                `<tr><td colspan="11" style="text-align:center;color:#f87171;padding:2rem;">
                    Error al cargar los datos de prorrateo.
                </td></tr>`;
        });
});

// ── Period filter ───────────────────────────────────────────────
const populatePeriodFilter = () => {
    const sel = document.getElementById("periodFilter");
    const periods = [...new Set(rawProrrateo.map(e => e.periodo))].sort().reverse();
    


    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
    });

    // Seleccionar por defecto el último período con liquidación de expensas válida (ga_monto/gb_monto > 0)
    const validPeriods = periods.filter(p => {
        const items = rawProrrateo.filter(e => e.periodo === p);
        if (items.length < 10) return false;
        return items.some(e => (e.ga_monto || 0) > 0 || (e.gb_monto || 0) > 0);
    });

    if (validPeriods.length > 0) {
        sel.value = validPeriods[0];
    } else if (periods.length > 0) {
        sel.value = periods[0];
    }

    const sidebarBadge = document.getElementById("sidebarPeriods");
    if (sidebarBadge && periods.length > 0) {
        sidebarBadge.textContent = `${periods.length} meses (${periods[periods.length - 1]} a ${periods[0]})`;
    }
};

// ── Event listeners ─────────────────────────────────────────────
const setupEventListeners = () => {
    const periodSel = document.getElementById("periodFilter");
    const searchInp = document.getElementById("searchInput");

    periodSel.addEventListener("change", applyFilter);
    searchInp.addEventListener("input", applyFilter);

    // Close modal on overlay click
    document.getElementById("ufModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("ufModal")) closeModal();
    });
};

// ── Apply filters ───────────────────────────────────────────────
const applyFilter = () => {
    const period = document.getElementById("periodFilter").value;
    const search = document.getElementById("searchInput").value.toLowerCase().trim();

    filteredProrrateo = rawProrrateo.filter(item => {
        const okPeriod = item.periodo === period;
        const okSearch = !search || 
            item.propietario.toLowerCase().includes(search) || 
            item.dpto.toLowerCase().includes(search) ||
            String(item.uf).includes(search);
        return okPeriod && okSearch;
    });

    currentPage = 1;
    updateDashboard(period);
};

// ── Master update ───────────────────────────────────────────────
const updateDashboard = (period) => {
    renderKPIs(period);
    auditCoeficients(period);
    renderMorosityChart(period);
    renderCajaChart(period);
    renderTable();
};

// ── COEFICIENTS AUDITOR ──────────────────────────────────────────
const auditCoeficients = (period) => {
    const alertsDiv = document.getElementById("coeficientAlerts");
    if (!alertsDiv) return;

    const periodData = rawProrrateo.filter(item => item.periodo === period);
    if (periodData.length === 0) {
        alertsDiv.style.display = "none";
        return;
    }

    const sumGA = periodData.reduce((sum, item) => sum + (item.porcentual || item.ga_pct || 0), 0);

    let messages = [];
    let alertClass = "success-alert";
    let icon = "📊";

    if (sumGA > 0 && Math.abs(sumGA - 100) > 0.01) {
        alertClass = "warning-alert";
        icon = "ℹ️";
        messages.push(`<strong>Prorrateo de Expensas Comunes (GA):</strong> Suma de coeficientes en esta liquidación: <strong>${sumGA.toFixed(3)}%</strong> (Descalce teórico del 0.210% debido a unidades/locales exentos de determinados rubros comunes).`);
    } else {
        messages.push(`<strong>Auditoría de Coeficientes:</strong> La suma de los coeficientes de copropiedad del edificio cierra correctamente al 100%.`);
    }

    const ufDeviations = [];
    periodData.forEach(item => {
        const ufHistory = rawProrrateo.filter(h => h.uf === item.uf);
        const gaValues = ufHistory.map(h => h.porcentual || h.ga_pct || 0);

        const getMode = (arr) => {
            const counts = {};
            let maxCount = 0;
            let mode = arr[0] || 0;
            arr.forEach(val => {
                const rounded = Math.round(val * 10000) / 10000;
                counts[rounded] = (counts[rounded] || 0) + 1;
                if (counts[rounded] > maxCount) {
                    maxCount = counts[rounded];
                    mode = rounded;
                }
            });
            return mode;
        };

        const modalGA = getMode(gaValues);
        const itemGA = item.porcentual || item.ga_pct || 0;

        if (modalGA > 0 && Math.abs(itemGA - modalGA) > 0.001) {
            ufDeviations.push(`Depto ${item.dpto || 'UF '+item.uf} (UF ${item.uf}): alícuota ${itemGA.toFixed(3)}% (vs. modal histórico: ${modalGA.toFixed(3)}%)`);
        }
    });

    if (ufDeviations.length > 0) {
        messages.push(`
            <details style="margin-top: 0.5rem;">
                <summary style="cursor: pointer; font-weight: 700; color: #fbbf24;">
                    🔍 Ver desplegable con las ${ufDeviations.length} U.F. con ajustes de alícuota...
                </summary>
                <ul style="margin: 0.5rem 0 0 1.2rem; padding: 0; max-height: 180px; overflow-y: auto; font-size: 0.8rem; color: var(--text-2);">
                    ${ufDeviations.map(d => `<li>${d}</li>`).join("")}
                </ul>
            </details>
        `);
    }

    alertsDiv.className = `coef-alert ${alertClass}`;
    alertsDiv.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span><div style="flex:1;">${messages.join("<br>")}</div>`;
    alertsDiv.style.display = "flex";
};

// ── KPIs RENDERER ────────────────────────────────────────────────
const renderKPIs = (period) => {
    const periodData = rawProrrateo.filter(item => item.periodo === period);

    // 1. Facturado Período: total devengado en gastos.json para este período (o suma de componentes positivos)
    let totalFacturado = 0;
    if (typeof rawGastos !== 'undefined' && rawGastos.length > 0) {
        totalFacturado = rawGastos.filter(g => g.periodo === period).reduce((sum, g) => sum + Number(g.monto || 0), 0);
    }
    
    if (totalFacturado === 0) {
        totalFacturado = periodData.reduce((sum, item) => {
            const ga = Math.abs(Number(item.ga_monto || item.gastos_comunes || 0));
            const gb = Math.abs(Number(item.gb_monto || item.servicio_seguridad || 0));
            const fo = Math.abs(Number(item.fondo_operativo_monto || item.fondo_reserva || 0));
            const ge = Math.abs(Number(item.gastos_extra || item.gastos_extraordinarios || 0));
            const ev = Math.abs(Number(item.red_ajustes || item.eventual || 0));
            return sum + (ga + gb + fo + ge + ev);
        }, 0);
    }

    // 2. Recaudado: suma de cobros recibidos
    const totalRecaudado = periodData.reduce((sum, item) => sum + (item.pagos && Number(item.pagos) > 0 ? Number(item.pagos) : 0), 0);

    // 3. Deuda Acumulada: suma de saldos deudores acumulados
    const totalDeuda = periodData.reduce((sum, item) => {
        const val = Number(item.saldo !== undefined ? item.saldo : (item.deuda || 0));
        return sum + (val > 0 ? val : 0);
    }, 0);

    // 4. Intereses por Mora
    const totalInteres = periodData.reduce((sum, item) => sum + Number(item.interes_mora || item.interes || 0), 0);

    const recPct = totalFacturado > 0 ? (totalRecaudado / totalFacturado) * 100 : 0;

    const elFact = document.getElementById("kpiFacturado");
    if (elFact) elFact.textContent = fmt(totalFacturado);

    const elRec = document.getElementById("kpiRecaudado");
    if (elRec) elRec.textContent = fmt(totalRecaudado);

    const elPct = document.getElementById("kpiRecaudadoPct");
    if (elPct) elPct.textContent = `${recPct.toFixed(1)}% cobrado en término`;

    const elDeuda = document.getElementById("kpiDeuda");
    if (elDeuda) elDeuda.textContent = fmt(totalDeuda);

    const elInteres = document.getElementById("kpiInteres");
    if (elInteres) elInteres.textContent = fmt(totalInteres);
};

// ── BAR CHART: TOP MOROSITY ──────────────────────────────────────
const renderMorosityChart = (period) => {
    if (typeof ApexCharts === 'undefined') return;
    const periodData = rawProrrateo.filter(item => item.periodo === period);
    
    // Filtrar los que tienen deuda acumulada > 0 y ordenar de mayor a menor
    const debtors = periodData
        .filter(item => item.deuda > 0)
        .sort((a, b) => b.deuda - a.deuda)
        .slice(0, 7);

    const seriesData = debtors.map(item => Math.round(item.deuda));
    const categories = debtors.map(item => `UF ${String(item.uf).padStart(3, '0')} (${item.dpto})`);

    const opts = {
        series: [{
            name: 'Deuda Acumulada',
            data: seriesData
        }],
        chart: { type: 'bar', height: 230, foreColor: '#94a3b8', toolbar: { show: false }, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%' } },
        colors: ['#f43f5e'],
        dataLabels: { enabled: false },
        xaxis: {
            categories: categories,
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: {
            theme: 'dark',
            y: { formatter: v => fmtFull(v) }
        }
    };

    if (chartMorosity) chartMorosity.destroy();
    chartMorosity = new ApexCharts(document.querySelector("#morosityChart"), opts);
    chartMorosity.render();
};

// ── DONUT CHART: CAJA STATUS ──────────────────────────────────────
const renderCajaChart = (period) => {
    if (typeof ApexCharts === 'undefined') return;
    const periodData = rawProrrateo.filter(item => item.periodo === period);
    
    const pagos = periodData.reduce((sum, item) => sum + item.pagos, 0);
    const impagos = periodData.reduce((sum, item) => sum + item.deuda, 0);

    const series = [Math.round(pagos), Math.round(impagos)];
    const labels = ["Cobrado", "Deuda Pendiente"];
    const colors = ["#10b981", "#f43f5e"];

    const opts = {
        series,
        labels,
        chart: { type: 'donut', height: 230, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        stroke: { show: false },
        legend: { show: true, position: 'bottom', labels: { colors: '#94a3b8' } },
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

    if (chartCaja) chartCaja.destroy();
    chartCaja = new ApexCharts(document.querySelector("#cajaChart"), opts);
    chartCaja.render();
};

// ── TABLE RENDERER ───────────────────────────────────────────────
const renderTable = () => {
    const tbody = document.getElementById("prorrateoTableBody");
    // Deduplicar U.F.s para mostrar exactamente 1 fila por UF
    const ufMap = new Map();
    filteredProrrateo.forEach(item => {
        const existing = ufMap.get(item.uf);
        if (!existing) {
            ufMap.set(item.uf, item);
        } else {
            const currentPct = Number(item.ga_pct || item.porcentual || 0);
            const existingPct = Number(existing.ga_pct || existing.porcentual || 0);
            if (currentPct > existingPct) {
                ufMap.set(item.uf, item);
            }
        }
    });
    const sorted = Array.from(ufMap.values()).sort((a, b) => a.uf - b.uf);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;color:var(--text-3);padding:2rem;">No se encontraron registros de prorrateo.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(item => {
        const ga = Number(item.gastos_comunes || item.ga_monto || 0);
        const gb = Number(item.servicio_seguridad || item.gb_monto || 0);
        const fo = Number(item.fondo_reserva || item.fondo_operativo_monto || 0);
        const ge = Number(item.gastos_extraordinarios || item.gastos_extra || 0);
        const ev = Number(item.eventual || item.red_ajustes || 0);

        const tMes = (item.total_mes !== undefined && !isNaN(Number(item.total_mes))) ? Number(item.total_mes) : (ga + gb + fo + ge + ev);
        const tPagar = (item.total_a_pagar !== undefined && !isNaN(Number(item.total_a_pagar))) ? Number(item.total_a_pagar) : ((item.total !== undefined && !isNaN(Number(item.total))) ? Number(item.total) : tMes);
        const isDeudor = tPagar > tMes;

        const rawDpto = item.dpto || item.ubicacion || item.depto || `U.F. ${item.uf}`;
        const dptoStr = rawDpto.replace(/\s+-[0-9\s]+[A-Za-zÁÉÍÓÚñÑ].*$/g, '').replace(/\s+[A-ZÁÉÍÓÚñÑ]{2,}.*$/g, '').trim();
        const propStr = `Propietario U.F. ${item.uf}`;
        const pctVal = Number(item.porcentual || item.ga_pct || 0);

        return `
        <tr class="uf-row" onclick="openModal(${item.uf})">
            <td style="font-weight:600; text-align:center;">${String(item.uf).padStart(3, '0')}</td>
            <td style="white-space:nowrap; font-weight:500;">${dptoStr}</td>
            <td style="text-align:center; color:var(--text-3);">${pctVal.toFixed(3)}%</td>
            <td style="text-align:right; color:var(--text-3);">${fmt(item.saldo_anterior || 0)}</td>
            <td style="text-align:right; color:var(--green); font-weight:500;">${(item.pagos || 0) > 0 ? fmt(item.pagos) : '—'}</td>
            <td style="text-align:right; color:${(item.saldo_mes || 0) > 0 ? 'var(--red)' : ((item.saldo_mes || 0) < 0 ? 'var(--green)' : 'var(--text-3)')};">${(item.saldo_mes || 0) !== 0 ? fmt(item.saldo_mes) : '—'}</td>
            <td style="text-align:right;">${fmt(ga)}</td>
            <td style="text-align:right;">${fmt(gb)}</td>
            <td style="text-align:right;">${fmt(fo)}</td>
            <td style="text-align:right;">${ge > 0 ? fmt(ge) : '—'}</td>
            <td style="text-align:right;">${ev > 0 ? fmt(ev) : '—'}</td>
            <td style="text-align:right; font-weight:600; color:var(--text-1);">${fmt(tMes)}</td>
            <td style="text-align:right; color:var(--purple); font-weight:500;">${(item.interes_mora || item.interes || 0) > 0 ? fmt(item.interes_mora || item.interes) : '—'}</td>
            <td style="text-align:right; font-weight:800; color:var(--accent);">${fmt(tPagar)}</td>
        </tr>`;
    }).join('');
};

// ── MODAL DETALLE U.F. ───────────────────────────────────────────
const openModal = (ufNum) => {
    const ufRecords = rawProrrateo
        .filter(item => item.uf === ufNum)
        .sort((a, b) => a.periodo.localeCompare(b.periodo));

    if (ufRecords.length === 0) return;

    const latest = ufRecords[ufRecords.length - 1];

    document.getElementById("modalTitle").textContent = `U.F. ${String(latest.uf).padStart(3, '0')} — Departamento ${latest.dpto}`;
    document.getElementById("modalSubtitle").textContent = `Historial de Prorrateo y Liquidación`;
    
    // Coeficientes
    document.getElementById("modalCoefA").textContent = `${latest.ga_pct.toFixed(4)}%`;
    document.getElementById("modalCoefB").textContent = `${latest.gb_pct.toFixed(4)}%`;

    // Estado de pago
    const isDeudor = latest.deuda > 0;
    const badge = document.getElementById("modalStatusBadge");
    if (isDeudor) {
        badge.textContent = `Debe ${fmt(latest.deuda)}`;
        badge.style.color = "var(--red)";
    } else {
        badge.textContent = "Al Día";
        badge.style.color = "var(--green)";
    }

    // Auditoría de Intereses por Mora (Cálculo sobre el saldo deudor neto del propio período)
    const auditDiv = document.getElementById("modalInterestAudit");
    const warnings = [];
    const normalChecks = [];

    for (let i = 0; i < ufRecords.length; i++) {
        const curr = ufRecords[i];
        const baseDeuda = curr.saldo_anterior - curr.pagos;
        if (curr.interes > 0 && baseDeuda > 0) {
            const tasa = (curr.interes / baseDeuda) * 100;
            if (tasa > 3.05) { // Tolerancia por redondeos menores
                warnings.push({
                    periodo: curr.periodo,
                    interes: curr.interes,
                    baseDeuda: baseDeuda,
                    tasa: tasa
                });
            } else {
                normalChecks.push({
                    periodo: curr.periodo,
                    interes: curr.interes,
                    baseDeuda: baseDeuda,
                    tasa: tasa
                });
            }
        }
    }

    if (warnings.length > 0) {
        auditDiv.style.display = "block";
        auditDiv.innerHTML = `
            <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); border-radius:10px; padding:0.8rem 1rem;">
                <h4 style="font-size:0.85rem; color:var(--red); margin:0 0 0.4rem 0; display:flex; align-items:center; gap:6px;">⚠️ Cargo Excesivo de Intereses Detectado</h4>
                <div style="font-size:0.75rem; color:var(--text-2); line-height:1.45;">
                    Se detectaron meses con recargos por mora que exceden el límite del 3.0% mensual establecido:
                    <ul style="margin:6px 0 0 16px; padding:0; display:flex; flex-direction:column; gap:4px;">
                        ${warnings.map(w => `
                            <li>En <strong>${w.periodo}</strong> se cobró un interés de <strong>${fmt(w.interes)}</strong> sobre una deuda de ${fmt(w.baseDeuda)}, lo que equivale a una tasa del <strong>${w.tasa.toFixed(2)}%</strong> mensual.</li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
    } else if (normalChecks.length > 0) {
        auditDiv.style.display = "block";
        auditDiv.innerHTML = `
            <div style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:10px; padding:0.8rem 1rem;">
                <h4 style="font-size:0.85rem; color:var(--green); margin:0 0 0.4rem 0; display:flex; align-items:center; gap:6px;">✅ Intereses Auditados Correctamente</h4>
                <div style="font-size:0.75rem; color:var(--text-2); line-height:1.4;">
                    Los recargos por mora cobrados a esta unidad se ajustan al límite reglamentario (tasa promedio aplicada: <strong>${(normalChecks.reduce((a,b) => a + b.tasa, 0) / normalChecks.length).toFixed(2)}%</strong> mensual).
                </div>
            </div>
        `;
    } else {
        auditDiv.style.display = "none";
    }

    // Historial
    const historyList = document.getElementById("ufHistoryList");
    historyList.innerHTML = [...ufRecords].reverse().map(e => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; padding:0.6rem 0.8rem; font-size:0.8rem;">
            <div>
                <span style="font-weight:600; color:var(--text-1);">${e.periodo}</span>
                <span style="margin-left:8px; color:var(--text-3);">Facturado: ${fmt(e.total)}</span>
            </div>
            <div style="font-weight:600; color:${e.deuda > 0 ? 'var(--red)' : 'var(--green)'};">
                ${e.deuda > 0 ? 'Deuda: ' + fmt(e.deuda) : 'Pagado: ' + fmt(e.pagos)}
            </div>
        </div>
    `).join('');

    // Gráfico de evolución de expensas
    const seriesData = ufRecords.map(e => Math.round(e.total));
    const categories = ufRecords.map(e => e.periodo);

    const totalPeriods = categories.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series: [{
            name: 'Expensas Facturadas',
            data: seriesData
        }],
        chart: {
            type: 'area',
            height: 230,
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
            background: 'transparent'
        },
        stroke: { curve: 'smooth', width: 2 },
        colors: ['#06b6d4'],
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.05 }
        },
        dataLabels: { enabled: false },
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

    if (typeof ApexCharts !== 'undefined') {
        if (chartUfHistory) chartUfHistory.destroy();
        chartUfHistory = new ApexCharts(document.querySelector("#ufHistoryChart"), opts);
        chartUfHistory.render().then(() => {
            setTimeout(() => {
                if (chartUfHistory) chartUfHistory.zoomX(minIndex, maxIndex);
            }, 100);
        });
    }

    document.getElementById("ufModal").classList.add("open");
};

const closeModal = () => {
    document.getElementById("ufModal").classList.remove("open");
};

// ── EXPORT CSV ──────────────────────────────────────────────────
const exportCSV = () => {
    const headers = ["Período", "UF", "Ubicación / Depto", "Propietario", "Porcentual (%)", "Saldo Anterior", "Pagos", "Saldo Mes", "Gastos Comunes", "Seguridad", "Fondo Reserva", "Gastos Extra", "Eventual", "Total Mes", "Int Mora", "Total a Pagar"];
    const rows = filteredProrrateo.map(e => [
        e.periodo,
        e.uf,
        `"${(e.dpto || '').replace(/"/g, '""')}"`,
        `"${(e.propietario || '').replace(/"/g, '""')}"`,
        (e.porcentual || e.ga_pct || 0).toFixed(3),
        (e.saldo_anterior || 0).toFixed(2),
        (e.pagos || 0).toFixed(2),
        (e.saldo_mes || 0).toFixed(2),
        (e.gastos_comunes || e.ga_monto || 0).toFixed(2),
        (e.servicio_seguridad || e.gb_monto || 0).toFixed(2),
        (e.fondo_reserva || e.fondo_operativo_monto || 0).toFixed(2),
        (e.gastos_extraordinarios || 0).toFixed(2),
        (e.eventual || 0).toFixed(2),
        (e.total_mes || 0).toFixed(2),
        (e.interes_mora || e.interes || 0).toFixed(2),
        (e.total_a_pagar || e.total || 0).toFixed(2)
    ]);

    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sarmiento360_prorrateo_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ── EXPORT EXCEL (.XLSX) ─────────────────────────────────────────
const exportXLSX = () => {
    if (typeof XLSX === 'undefined') {
        alert("La librería para exportar Excel se está cargando. Por favor, reintente en unos segundos.");
        return;
    }

    const sorted = [...filteredProrrateo].sort((a, b) => a.uf - b.uf);

    const dataToExport = sorted.map(item => ({
        "Período": item.periodo,
        "U.F.": item.uf,
        "Ubicación / Depto": item.dpto,
        "Propietario / Consorcista": item.propietario,
        "Porcentual (%)": item.porcentual || item.ga_pct || 0,
        "Saldo Anterior ($)": item.saldo_anterior,
        "Pagos ($)": item.pagos,
        "Saldo Mes ($)": item.saldo_mes,
        "Gastos Comunes ($)": item.gastos_comunes || item.ga_monto || 0,
        "Seguridad ($)": item.servicio_seguridad || item.gb_monto || 0,
        "Fondo Reserva ($)": item.fondo_reserva || item.fondo_operativo_monto || 0,
        "Gastos Extra. ($)": item.gastos_extraordinarios || 0,
        "Eventual ($)": item.eventual || 0,
        "Total Mes ($)": item.total_mes || 0,
        "Int. Mora ($)": item.interes_mora || item.interes || 0,
        "Total a Pagar ($)": item.total_a_pagar || item.total || 0
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);

    // Formatear anchos de columnas
    ws['!cols'] = [
        { wch: 10 }, // Período
        { wch: 6 },  // UF
        { wch: 16 }, // Depto
        { wch: 28 }, // Propietario
        { wch: 12 }, // % Porcentual
        { wch: 16 }, // Saldo Ant
        { wch: 14 }, // Pagos
        { wch: 14 }, // Saldo Mes
        { wch: 16 }, // Gastos Comunes
        { wch: 14 }, // Seguridad
        { wch: 14 }, // Fondo Reserva
        { wch: 14 }, // Gastos Extra
        { wch: 12 }, // Eventual
        { wch: 16 }, // Total Mes
        { wch: 12 }, // Int Mora
        { wch: 18 }  // Total Pagar
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prorrateo U.F. Sarmiento 360");

    const selP = document.getElementById("periodFilter")?.value || "todos";
    const filename = `sarmiento360_prorrateo_uf_${selP}_${Date.now()}.xlsx`;

    XLSX.writeFile(wb, filename);
};

// ── EXPORT PDF ──────────────────────────────────────────────────
const exportPDF = () => {
    window.print();
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
