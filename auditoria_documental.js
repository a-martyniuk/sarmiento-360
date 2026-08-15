/**
 * Sarmiento 360 — Módulo de Auditoría Documental y Detección de Gastos/Obligaciones Omitidas
 * Inferencia probabilística y análisis de consistencia de completitud histórica.
 */

// ── 1. EXCEPCIONES CONFIGURABLES (AUDIT_EXCEPTIONS) ───────────────
const AUDIT_EXCEPTIONS = [
    {
        concepto: "Seguro Consorcio",
        meses_excluidos: ["04", "05"],
        motivo: "Póliza anual abonada en 10 cuotas consecutivas (meses de descanso en abril y mayo)"
    },
    {
        concepto: "SAC",
        meses_excluidos: ["01", "02", "03", "04", "05", "07", "08", "09", "10", "11"],
        motivo: "Sueldo Anual Complementario se liquida legalmente en los meses 06 y 12"
    },
    {
        concepto: "Limpieza de Tanques",
        meses_excluidos: ["01", "02", "03", "04", "06", "07", "08", "09", "10", "12"],
        motivo: "Limpieza e inspección de tanques de agua potable con frecuencia semestral"
    }
];

// ── 2. NORMALIZADOR DE CONCEPTOS ─────────────────────────────────
const normalizeConceptKey = (str) => {
    if (!str) return "";
    let s = String(str).toLowerCase().trim();
    
    // Identificadores críticos a preservar intactos
    const keyMatch = s.match(/(aysa|edesur|telecentro|flow|guillemi|allianz|fateryh|suterh|arca|afip|192498|192499|192500|05637256)/);
    const keyId = keyMatch ? keyMatch[1] : "";
    
    // Remover meses, fechas, comprobantes y números sueltos
    s = s.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gi, '');
    s = s.replace(/\b(202[0-9]|201[0-9])\b/g, '');
    s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '');
    s = s.replace(/\b(factura|comprobante|nro|n°|cuota|periodo|período|mes|liq)\b/gi, '');
    s = s.replace(/[^a-z0-9áéíóúñ\s]/gi, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    
    if (keyId) return `${keyId}:${s.slice(0, 30)}`;
    return s.slice(0, 40);
};

// ── 3. MOTOR PRINCIPAL DE AUDITORÍA DOCUMENTAL ────────────────────
const runDocumentaryAudit = (rawExpenses) => {
    if (!rawExpenses || rawExpenses.length === 0) return [];
    
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    const totalPeriods = allPeriods.length;
    if (totalPeriods < 3) return [];
    
    // Agrupar por concepto normalizado
    const conceptsMap = {};
    rawExpenses.forEach(e => {
        const rawC = e.concepto || "";
        const key = normalizeConceptKey(rawC);
        if (!key) return;
        
        if (!conceptsMap[key]) {
            conceptsMap[key] = {
                key,
                rawSample: rawC,
                categoria: e.categoria || "Otros",
                rubro: e.rubro || "",
                proveedor: e.proveedor || "",
                periods: new Set(),
                amountsByPeriod: {},
                itemsByPeriod: {}
            };
        }
        conceptsMap[key].periods.add(e.periodo);
        conceptsMap[key].amountsByPeriod[e.periodo] = Number(e.monto || 0);
        conceptsMap[key].itemsByPeriod[e.periodo] = e;
    });
    
    const auditFindings = [];
    
    // Evaluar cada concepto recurrente
    Object.values(conceptsMap).forEach(data => {
        const activePeriods = [...data.periods].sort();
        const activeCount = activePeriods.length;
        const recurrenceRate = activeCount / totalPeriods;
        
        // Descartar compras o reparaciones esporádicas (menos de 3 apariciones o < 35% de frecuencia)
        if (activeCount < 3 && recurrenceRate < 0.35) return;
        
        // Inferir Frecuencia Esperada
        let frecuencia = "IRREGULAR";
        if (recurrenceRate >= 0.65) frecuencia = "MENSUAL";
        else if (recurrenceRate >= 0.40) frecuencia = "BIMESTRAL";
        else if (recurrenceRate >= 0.25) frecuencia = "TRIMESTRAL";
        
        // Verificar excepciones configuradas
        const matchedException = AUDIT_EXCEPTIONS.find(exc => 
            data.rawSample.toLowerCase().includes(exc.concepto.toLowerCase()) || data.key.includes(exc.concepto.toLowerCase())
        );
        
        const missingPeriods = allPeriods.filter(p => !data.periods.has(p));
        
        missingPeriods.forEach(mp => {
            const mNum = mp.split("-")[1];
            
            // Si el mes está en la lista de excepción configurada, ignorar
            if (matchedException && matchedException.meses_excluidos.includes(mNum)) {
                return;
            }
            
            const hasBefore = activePeriods.some(p => p < mp);
            const hasAfter = activePeriods.some(p => p > mp);
            
            // Calcular promedio histórico del concepto
            const amountsArr = Object.values(data.amountsByPeriod);
            const avgMonto = amountsArr.reduce((a, b) => a + b, 0) / (amountsArr.length || 1);
            
            // Detección de acumulación posterior
            let isAccumulated = false;
            if (hasAfter) {
                const nextPeriod = activePeriods.find(p => p > mp);
                const nextMonto = data.amountsByPeriod[nextPeriod] || 0;
                if (nextMonto >= (avgMonto * 1.65)) {
                    isAccumulated = true;
                }
            }
            
            // Detección de cargas laborales / previsionales asociadas
            const isLabor = data.categoria === "Sueldos y Cargas Sociales" || 
                            /cargas|contribucion|afip|arca|fateryh|suterh|art|jubilac/i.test(data.rawSample) ||
                            /fateryh|suterh|arca|afip/i.test(data.key);
            
            // Clasificación y Estado Probabilístico
            let tipoAlerta = "Posible gasto omitido";
            let prioridad = "🟡 Sugerencia";
            let estadoProbabilistico = "Sugerido";
            
            if (isAccumulated) {
                tipoAlerta = "Posible acumulación de deuda (salto de monto posterior)";
                prioridad = "🔴 Alta";
                estadoProbabilistico = "Probable";
            } else if (isLabor && (hasBefore || hasAfter)) {
                tipoAlerta = "Obligación laboral / previsional no documentada";
                prioridad = "🔴 Alta";
                estadoProbabilistico = "Probable";
            } else if (hasBefore && hasAfter) {
                tipoAlerta = "Omisión documental retrospectiva (ausencia con reaparición)";
                prioridad = recurrenceRate >= 0.75 ? "🔴 Alta" : "🟠 Revisar";
                estadoProbabilistico = recurrenceRate >= 0.75 ? "Confirmado" : "Probable";
            } else if (recurrenceRate >= 0.70) {
                tipoAlerta = "Gasto recurrente ausente en el período";
                prioridad = "🟠 Revisar";
                estadoProbabilistico = "Probable";
            } else {
                prioridad = "🟡 Sugerencia";
                estadoProbabilistico = "Sin evidencia suficiente";
            }
            
            // Score de Confianza (0 - 100%)
            let confidence = Math.round(
                (recurrenceRate * 50) + 
                (hasBefore && hasAfter ? 25 : 10) + 
                (isAccumulated ? 15 : 0) + 
                (isLabor ? 10 : 0)
            );
            confidence = Math.min(98, Math.max(35, confidence));
            
            // Rationale Explicativa
            let explicacion = `El concepto "${data.rawSample}" presenta un comportamiento ${frecuencia.toLowerCase()} recurrente (${activeCount} de ${totalPeriods} períodos, ${Math.round(recurrenceRate*100)}% de presencia histórica). `;
            if (hasBefore && hasAfter) {
                explicacion += `Figuraba en liquidaciones previas, desaparece en ${mp} y vuelve a figurar en períodos posteriores.`;
            } else if (isAccumulated) {
                explicacion += `Ausente en ${mp} y reaparece posteriormente con un importe significativamente mayor al promedio histórico ($ ${Math.round(avgMonto).toLocaleString('es-AR')}).`;
            } else if (isLabor) {
                explicacion += `Corresponde a obligaciones laborales/previsionales que no deberían interrumpirse mientras el personal permanezca activo.`;
            } else {
                explicacion += `No se encontró comprobante ni registro en la liquidación de ${mp}.`;
            }
            
            auditFindings.push({
                id: `AUD-${mp}-${data.key}`,
                periodo: mp,
                concepto: data.rawSample,
                categoria: data.categoria,
                frecuencia,
                tipoAlerta,
                prioridad,
                estadoProbabilistico,
                confianza: confidence,
                aparicionesHistoricas: `${activeCount}/${totalPeriods}`,
                ultimaAparicion: activePeriods[activePeriods.length - 1],
                montoEstimado: Math.round(avgMonto),
                explicacion,
                activePeriods,
                amountsByPeriod: data.amountsByPeriod
            });
        });
    });
    
    // Ordenar hallazgos: 1. Prioridad (Alta > Revisar > Sugerencia), 2. Confianza, 3. Período
    const prioOrder = { "🔴 Alta": 1, "🟠 Revisar": 2, "🟡 Sugerencia": 3 };
    return auditFindings.sort((a, b) => {
        if (prioOrder[a.prioridad] !== prioOrder[b.prioridad]) {
            return prioOrder[a.prioridad] - prioOrder[b.prioridad];
        }
        if (b.confianza !== a.confianza) return b.confianza - a.confianza;
        return b.periodo.localeCompare(a.periodo);
    });
};

// ── 4. AUDITORÍA DOCUMENTAL UI HANDLERS (COMPARTIDOS) ─────────────
let currentAuditFindings = [];
let activeModalFindingId = null;
let chartDocAuditConcept = null;
let globalRawExpenses = [];

const renderDocumentaryAuditSection = (expenses) => {
    if (expenses && expenses.length > 0) {
        globalRawExpenses = expenses;
    }
    if (!globalRawExpenses || globalRawExpenses.length === 0) return;

    currentAuditFindings = runDocumentaryAudit(globalRawExpenses);
    
    // Contadores para KPIs
    let high = 0, medium = 0, low = 0;
    currentAuditFindings.forEach(f => {
        if (f.prioridad === "🔴 Alta") high++;
        else if (f.prioridad === "🟠 Revisar") medium++;
        else low++;
    });
    
    const highEl = document.getElementById("docAuditKpiHigh");
    if (highEl) highEl.textContent = high;
    const medEl = document.getElementById("docAuditKpiMedium");
    if (medEl) medEl.textContent = medium;
    const lowEl = document.getElementById("docAuditKpiLow");
    if (lowEl) lowEl.textContent = low;
    const cleanEl = document.getElementById("docAuditKpiClean");
    if (cleanEl) {
        const allP = [...new Set(globalRawExpenses.map(e => e.periodo))];
        const affectedP = new Set(currentAuditFindings.map(f => f.periodo));
        cleanEl.textContent = Math.max(0, allP.length - affectedP.size);
    }
    
    renderDocumentaryAuditTable();
};

const renderDocumentaryAuditTable = () => {
    const tbody = document.getElementById("docAuditTableBody");
    if (!tbody) return;
    
    const prioFilter = document.getElementById("docAuditPriorityFilter")?.value || "todos";
    const statusFilter = document.getElementById("docAuditStatusFilter")?.value || "todos";
    
    let list = [...currentAuditFindings];
    
    if (prioFilter !== "todos") {
        list = list.filter(f => f.prioridad === prioFilter);
    }
    
    list = list.filter(f => {
        const saved = JSON.parse(localStorage.getItem(`SARM360_DOCAUDIT_${f.id}`) || "{}");
        const status = saved.status || "PENDIENTE";
        if (statusFilter === "todos") return true;
        return status === statusFilter;
    });
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-3); padding:2rem;">No se encontraron sugerencias de auditoría documental para los filtros seleccionados.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = list.map(f => {
        const saved = JSON.parse(localStorage.getItem(`SARM360_DOCAUDIT_${f.id}`) || "{}");
        const status = saved.status || "PENDIENTE";
        
        let statusBadgeClass = "badge-warning";
        let statusLabel = "⏳ PENDIENTE";
        if (status === "REVISADO") { statusBadgeClass = "badge-info"; statusLabel = "👁️ REVISADO"; }
        else if (status === "CONFIRMADO") { statusBadgeClass = "badge-danger"; statusLabel = "🔴 CONFIRMADO"; }
        else if (status === "DESCARTADO") { statusBadgeClass = "badge-success"; statusLabel = "🟢 DESCARTADO"; }
        
        const prioStyle = f.prioridad === "🔴 Alta" ? "color:var(--red); font-weight:700;" : (f.prioridad === "🟠 Revisar" ? "color:#fb923c; font-weight:600;" : "color:var(--text-3);");
        const fmtVal = typeof fmt === 'function' ? fmt(f.montoEstimado) : `$ ${f.montoEstimado.toLocaleString('es-AR')}`;
        
        return `
            <tr>
                <td style="text-align:center; ${prioStyle}">${f.prioridad}</td>
                <td style="font-weight:600; color:var(--text-1);">${f.periodo}</td>
                <td style="font-weight:500;">
                    <div style="color:var(--text-1); font-size:0.85rem;">${f.concepto}</div>
                    <div style="font-size:0.7rem; color:var(--text-3);">Monto est. histórico: ${fmtVal} <span style="font-size:0.65rem; color:var(--accent);">(ESTIMACIÓN HISTÓRICA)</span></div>
                </td>
                <td style="font-size:0.8rem; color:var(--text-2);">${f.categoria}</td>
                <td style="font-size:0.78rem; color:var(--text-2);">${f.tipoAlerta}</td>
                <td style="text-align:center; font-weight:600; font-size:0.8rem; color:var(--text-2);">${f.aparicionesHistoricas}</td>
                <td style="text-align:center;">
                    <span style="background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.25); color:var(--accent); padding:2px 8px; border-radius:12px; font-weight:700; font-size:0.75rem;">${f.confianza}%</span>
                </td>
                <td style="text-align:center;">
                    <span class="badge ${statusBadgeClass}" style="font-size:0.7rem;">${statusLabel}</span>
                </td>
                <td style="text-align:right;">
                    <button class="btn" onclick="openDocAuditModal('${f.id}')" style="background:rgba(6,182,212,0.12); border:1px solid rgba(6,182,212,0.3); color:var(--accent); font-size:0.75rem; padding:0.25rem 0.6rem;">🔍 Ver Evidencia</button>
                </td>
            </tr>
        `;
    }).join('');
};

const openDocAuditModal = (findingId) => {
    const finding = currentAuditFindings.find(f => f.id === findingId);
    if (!finding) return;
    
    activeModalFindingId = findingId;
    const modal = document.getElementById("docAuditModal");
    if (!modal) return;
    
    document.getElementById("docAuditModalTitle").textContent = `Auditoría: ${finding.concepto}`;
    document.getElementById("docAuditModalSubtitle").textContent = `Período Afectado: ${finding.periodo} · Prioridad: ${finding.prioridad} · Confianza: ${finding.confianza}%`;
    
    const fmtVal = typeof fmt === 'function' ? fmt(finding.montoEstimado) : `$ ${finding.montoEstimado.toLocaleString('es-AR')}`;

    const rationaleBox = document.getElementById("docAuditRationaleBox");
    rationaleBox.innerHTML = `
        <h4 style="margin:0 0 0.5rem 0; font-size:0.9rem; color:var(--accent); display:flex; align-items:center; gap:6px;">
            💡 Rationale de Auditoría Documental (${finding.estadoProbabilistico})
        </h4>
        <div style="font-size:0.82rem; color:var(--text-1); line-height:1.5;">
            ${finding.explicacion}
        </div>
        <div style="margin-top:0.75rem; padding-top:0.6rem; border-top:1px dashed rgba(6,182,212,0.2); font-size:0.75rem; color:var(--text-3); display:flex; flex-wrap:wrap; gap:12px;">
            <span>📌 <strong>Categoría:</strong> ${finding.categoria}</span>
            <span>⏱️ <strong>Frecuencia Inferida:</strong> ${finding.frecuencia}</span>
            <span>📊 <strong>Presencia Histórica:</strong> ${finding.aparicionesHistoricas}</span>
            <span>💰 <strong>Promedio Histórico:</strong> ${fmtVal}</span>
        </div>
    `;
    
    // Cargar formulario localStorage
    const saved = JSON.parse(localStorage.getItem(`SARM360_DOCAUDIT_${findingId}`) || "{}");
    document.getElementById("docAuditStatusSelect").value = saved.status || "PENDIENTE";
    document.getElementById("docAuditDiscardReasonSelect").value = saved.reason || "";
    document.getElementById("docAuditCommentInput").value = saved.comment || "";
    
    modal.classList.add("open");
    
    // Renderizar gráfico de línea temporal con ApexCharts
    renderDocAuditConceptChart(finding);
};

const closeDocAuditModal = () => {
    const modal = document.getElementById("docAuditModal");
    if (modal) modal.classList.remove("open");
};

const saveDocAuditState = () => {
    if (!activeModalFindingId) return;
    
    const status = document.getElementById("docAuditStatusSelect").value;
    const reason = document.getElementById("docAuditDiscardReasonSelect").value;
    const comment = document.getElementById("docAuditCommentInput").value;
    
    const dataToSave = { status, reason, comment, updatedAt: new Date().toISOString() };
    localStorage.setItem(`SARM360_DOCAUDIT_${activeModalFindingId}`, JSON.stringify(dataToSave));
    
    closeDocAuditModal();
    renderDocumentaryAuditTable();
};

const renderDocAuditConceptChart = (finding) => {
    const chartDiv = document.getElementById("docAuditConceptChart");
    if (!chartDiv || typeof ApexCharts === 'undefined') return;
    
    if (chartDocAuditConcept) {
        chartDocAuditConcept.destroy();
    }
    
    const allPeriods = [...new Set(globalRawExpenses.map(e => e.periodo))].sort();
    const seriesData = [];
    
    allPeriods.forEach(p => {
        if (finding.amountsByPeriod && finding.amountsByPeriod[p] !== undefined) {
            seriesData.push(finding.amountsByPeriod[p]);
        } else if (p === finding.periodo) {
            seriesData.push(finding.montoEstimado); // Omitido / Ausente
        } else {
            seriesData.push(0);
        }
    });
    
    const options = {
        series: [{
            name: "Monto Registrado ($ ARS)",
            data: seriesData
        }],
        chart: {
            type: 'bar',
            height: 240,
            background: 'transparent',
            toolbar: { show: false }
        },
        colors: ["#06b6d4"],
        plotOptions: {
            bar: {
                borderRadius: 4,
                columnWidth: '45%'
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: allPeriods,
            labels: { style: { colors: '#94a3b8', fontSize: '11px' } }
        },
        yaxis: {
            labels: {
                style: { colors: '#94a3b8', fontSize: '11px' },
                formatter: (val) => val > 0 ? `$ ${(val/1000).toFixed(0)}k` : '$ 0'
            }
        },
        tooltip: {
            theme: 'dark',
            y: {
                formatter: (val, { dataPointIndex }) => {
                    const p = allPeriods[dataPointIndex];
                    if (p === finding.periodo) {
                        return `⚠️ Ausente en liquidación (Est. $ ${val.toLocaleString('es-AR')})`;
                    }
                    return val > 0 ? `$ ${val.toLocaleString('es-AR')}` : 'Sin registro ($ 0)';
                }
            }
        },
        legend: { show: false }
    };
    
    chartDocAuditConcept = new ApexCharts(chartDiv, options);
    chartDocAuditConcept.render();
};

const exportDocumentaryAuditCSV = () => {
    if (!currentAuditFindings || currentAuditFindings.length === 0) {
        alert("No hay hallazgos de auditoría documental para exportar.");
        return;
    }
    
    const headers = [
        "ID Alerta",
        "Período",
        "Concepto",
        "Categoría",
        "Frecuencia Esperada",
        "Tipo de Alerta",
        "Prioridad",
        "Estado Probabilístico",
        "Confianza (%)",
        "Apariciones Históricas",
        "Monto Estimado Histórico",
        "Explicación / Rationale",
        "Estado Auditoría Humana",
        "Motivo Descarte",
        "Comentario Auditoría"
    ];
    
    const rows = currentAuditFindings.map(f => {
        const saved = JSON.parse(localStorage.getItem(`SARM360_DOCAUDIT_${f.id}`) || "{}");
        return [
            `"${f.id}"`,
            `"${f.periodo}"`,
            `"${f.concepto.replace(/"/g, '""')}"`,
            `"${f.categoria}"`,
            `"${f.frecuencia}"`,
            `"${f.tipoAlerta}"`,
            `"${f.prioridad}"`,
            `"${f.estadoProbabilistico}"`,
            f.confianza,
            `"${f.aparicionesHistoricas}"`,
            f.montoEstimado,
            `"${f.explicacion.replace(/"/g, '""')}"`,
            `"${saved.status || 'PENDIENTE'}"`,
            `"${(saved.reason || '').replace(/"/g, '""')}"`,
            `"${(saved.comment || '').replace(/"/g, '""')}"`
        ];
    });
    
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Sarmiento360_Auditoria_Documental_Omitidos_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// Exportar funciones para uso en browser y node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runDocumentaryAudit, normalizeConceptKey, AUDIT_EXCEPTIONS, renderDocumentaryAuditSection, exportDocumentaryAuditCSV };
}

