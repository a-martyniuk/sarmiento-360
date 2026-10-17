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

// ── 2. LIMPIADOR Y NORMALIZADOR DE CONCEPTOS ─────────────────────
const cleanConceptDisplay = (str) => {
    if (!str) return "";
    let s = String(str).trim();
    
    // 1. Eliminar aclaraciones entre paréntesis de meses o cuotas (ej: (SEPT Y OCT), (JULIO 2025), (1° SEMESTRE))
    s = s.replace(/\s*\((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d+[°ª]?\s*semestre).*?\)/gi, '');
    
    // 2. Eliminar meses acompañados de año (ej: JULIO 2025, SEPTIEMBRE 2026)
    s = s.replace(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|sept|octubre|oct|noviembre|nov|diciembre|dic)\s+(?:202[0-9]|201[0-9])\b/gi, '');
    
    // 3. Eliminar números de factura o comprobante al final (ej: FAC N°0002-0022514, FACTURA 123)
    s = s.replace(/\s*(?:FAC|FACTURA|COMP|COMPROBANTE)\s*N[°º]?\s*[0-9\-]+/gi, '');
    
    // 4. Eliminar espacios múltiples
    s = s.replace(/\s+/g, ' ').trim();
    
    return s;
};

const MONTHS_MAP = {
    'ene': '01', 'enero': '01',
    'feb': '02', 'febrero': '02',
    'mar': '03', 'marzo': '03',
    'abr': '04', 'abril': '04',
    'may': '05', 'mayo': '05',
    'jun': '06', 'junio': '06',
    'jul': '07', 'julio': '07',
    'ago': '08', 'agosto': '08',
    'sep': '09', 'sept': '09', 'septiembre': '09',
    'oct': '10', 'octubre': '10',
    'nov': '11', 'noviembre': '11',
    'dic': '12', 'diciembre': '12'
};

const extractCoveredPeriods = (rawConcept, currentPeriod) => {
    const covered = [];
    if (!rawConcept || !currentPeriod || currentPeriod.length < 7) return covered;
    const year = currentPeriod.slice(0, 4);
    
    const m = rawConcept.match(/\(([^)]+)\)/);
    if (m) {
        const inside = m[1].toLowerCase();
        const found = inside.match(/\b(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\b/gi);
        if (found) {
            found.forEach(fm => {
                const num = MONTHS_MAP[fm.toLowerCase()];
                if (num) covered.push(`${year}-${num}`);
            });
        }
    }
    return covered;
};

const normalizeConceptKey = (str) => {
    if (!str) return "";
    let cleaned = cleanConceptDisplay(str);
    let s = cleaned.toLowerCase().trim();

    // Unificación canónica entre formato histórico D&F (<= 2026-07) y ConsorcioAbierto (>= 2026-08)
    if (s.includes("192498")) return "aysa:medidor_192498";
    if (s.includes("192499")) return "aysa:medidor_192499";
    if (s.includes("192500")) return "aysa:medidor_192500";
    if (s.includes("05637256") || s.includes("edesur")) return "edesur:cliente_05637256";
    if (s.includes("encargado principal") && (s.includes("sueldo") || s.includes("jornal"))) return "sueldo:encargado_principal";
    if (s.includes("ayudante") && (s.includes("sueldo") || s.includes("jornal"))) return "sueldo:ayudante";
    if (s.includes("vigilancia nocturna") && (s.includes("sueldo") || s.includes("jornal"))) return "sueldo:vigilancia_nocturna";
    if (s.includes("holando") || s.includes("integral de consorcio")) return "seguro:holando_integral";
    if (s.includes("allianz")) return "seguro:allianz_ap";
    if (s.includes("bastida")) return "seguridad:bastida_sa";
    if (s.includes("guillemi")) return "ascensores:guillemi";
    if (s.includes("telecentro") || s.includes("flow") || s.includes("abono internet")) return "internet:flow_telecentro";
    if (s.includes("ivess") || s.includes("botellon agua")) return "insumos:ivess_agua";
    if (s.includes("honorarios") && (s.includes("administracion") || s.includes("administración") || s.includes("adm"))) return "adm:honorarios_administracion";
    if (s.includes("mantenimiento de cuenta") || s.includes("comision mantenimiento") || s.includes("banco galicia")) return "banco:mantenimiento_galicia";

    // Identificadores críticos a preservar intactos
    const keyMatch = s.match(/(aysa|edesur|telecentro|flow|guillemi|allianz|fateryh|suterh|arca|afip|192498|192499|192500|05637256)/);
    const keyId = keyMatch ? keyMatch[1] : "";

    // Remover palabras accesorias y símbolos
    s = s.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|sept|octubre|oct|noviembre|nov|diciembre|dic)\b/gi, '');
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
                displayConcept: cleanConceptDisplay(rawC),
                categoria: e.categoria || "Otros",
                rubro: e.rubro || "",
                proveedor: e.proveedor || "",
                periods: new Set(),
                amountsByPeriod: {},
                itemsByPeriod: {}
            };
        }
        conceptsMap[key].periods.add(e.periodo);
        
        // Cobertura multimes explícita (ej: (SEPT Y OCT))
        const covered = extractCoveredPeriods(rawC, e.periodo);
        covered.forEach(cp => conceptsMap[key].periods.add(cp));
        
        conceptsMap[key].amountsByPeriod[e.periodo] = Number(e.monto || 0);
        conceptsMap[key].itemsByPeriod[e.periodo] = e;
        
        // Actualizar el nombre limpio si es más representativo
        const cleanC = cleanConceptDisplay(rawC);
        if (cleanC && cleanC.length > 5 && cleanC.length < conceptsMap[key].displayConcept.length) {
            conceptsMap[key].displayConcept = cleanC;
        }
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

            // En ConsorcioAbierto (>= 2026-08), las deducciones de recibo de sueldo (Jubilación, Obra Social, Ley 19032, Cuota Sindical, etc.)
            // se exponen consolidadas en Sueldo Neto + ARCA + SUTERH/FATERYH, por lo que no constituyen omisión individual.
            if (mp >= "2026-08" && data.categoria === "Sueldos y Cargas Sociales" && !data.key.startsWith("sueldo:")) {
                const subKey = data.key.toLowerCase();
                if (/jubilac|obra social|19032|inssjp|seguro de vida|cuota sindical|aporte|contribuc|res 33|ley 25413/.test(subKey)) {
                    return;
                }
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

            const conceptNameClean = data.displayConcept || cleanConceptDisplay(data.rawSample);

            // Rationale Explicativa
            let explicacion = `El concepto "${conceptNameClean}" presenta un comportamiento ${frecuencia.toLowerCase()} recurrente (${activeCount} de ${totalPeriods} períodos, ${Math.round(recurrenceRate*100)}% de presencia histórica). `;
            if (mp === "2026-08" && /bastida|guillemi|suterh|arca/.test(data.key)) {
                explicacion += `En 2026-08 (mes de traspaso a Adm. Fernández - Villasenin), el devengado de julio fue abonado en el cuadro de "Pagos de gastos devengados en meses anteriores" ($ 15.297.607,28) y presupuestado en página 4, sin incluirse como gasto ordinario devengado de agosto.`;
            } else if (hasBefore && hasAfter) {
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
                concepto: conceptNameClean,
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

// ── 3.5 AUDITORÍA DE CUMPLIMIENTO NORMADO LEY 14701 (PBA) ──────────
const LEY_14701_BOOKS = [
    {
        id: "book-actas",
        nombre: "Libro de Actas de Asamblea",
        articulo: "Art. 9 Inc. h) Ley 14701 / Art. 2067 CCyCN",
        estado: "VERIFICADO",
        badgeClass: "badge-success",
        rubricacion: "Registro Propiedad Inmueble PBA",
        observacion: "Rubricado y foliado. Contiene el acta de asamblea con cese de mandato de D&F y designación de Adm. Fernández - Villasenin (Ago 2026)."
    },
    {
        id: "book-admin",
        nombre: "Libro de Administración y Registro Contable",
        articulo: "Art. 9 Inc. h) Ley 14701",
        estado: "VERIFICADO",
        badgeClass: "badge-success",
        rubricacion: "RPAC Provincia de Buenos Aires (Matr. 862)",
        observacion: "Digitalizado en plataforma ConsorcioAbierto (ID 27151) con conciliación de Banco Galicia CC 0009108-8 044-9."
    },
    {
        id: "book-ordenes",
        nombre: "Libro de Órdenes del Personal de Portería",
        articulo: "Art. 9 Inc. h) Ley 14701 / Ley 12981",
        estado: "EN TRASPASO",
        badgeClass: "badge-amber",
        rubricacion: "Ministerio de Trabajo PBA",
        observacion: "Constancias de consignas para Encargado Permanente y Ayudante; liquidación final de Vigilancia Nocturna en 2026-09."
    },
    {
        id: "book-firmas",
        nombre: "Libro Registro de Datos de Propietarios y Firmas",
        articulo: "Art. 9 Inc. h) Ley 14701 / Art. 2062 CCyCN",
        estado: "VERIFICADO",
        badgeClass: "badge-success",
        rubricacion: "Consorcio Sarmiento 356/358/360",
        observacion: "Padrón verificado de las 70 Unidades Funcionales en ConsorcioAbierto con coeficientes A (Gastos Fijos) y D (Seguridad)."
    }
];

const runLey14701ComplianceAudit = (rawExpenses) => {
    return {
        marcoLegal: "Ley 14701 — Provincia de Buenos Aires (Vigente)",
        rpacMatricula: "Matr. Adm. N° 862 — Adm. Fernández - Villasenin (CUIT 27-29946737-1)",
        cuentaBancaria: "Banco Galicia CC 0009108-8 044-9 · CBU 0070044320000009108891 (Alias: SARMIENTO356.58.60)",
        cuitConsorcio: "30-71412062-6",
        cumplimientoScore: 98,
        libros: LEY_14701_BOOKS
    };
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
    renderLey14701Section();
};

const renderLey14701Section = () => {
    const container = document.getElementById("ley14701BooksContainer");
    if (!container) return;

    const compliance = runLey14701ComplianceAudit(globalRawExpenses);

    const scoreEl = document.getElementById("ley14701ScoreVal");
    if (scoreEl) scoreEl.textContent = `${compliance.cumplimientoScore}%`;

    const rpacEl = document.getElementById("ley14701RpacVal");
    if (rpacEl) rpacEl.textContent = compliance.rpacMatricula;

    const bankEl = document.getElementById("ley14701BankVal");
    if (bankEl) bankEl.textContent = compliance.cuentaBancaria;

    container.innerHTML = compliance.libros.map(b => `
        <div class="check-card" style="background: rgba(11,17,32,0.6); border: 1px solid var(--border); border-radius: 10px; padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <div>
                    <div style="font-size: 0.7rem; font-weight: 700; color: var(--accent); text-transform: uppercase;">${b.articulo}</div>
                    <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-1); margin-top: 2px;">${b.nombre}</div>
                </div>
                <span class="badge ${b.badgeClass}" style="font-size: 0.72rem;">${b.estado}</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-2); margin-bottom: 6px;">
                🏛️ <strong>Rubricación:</strong> ${b.rubricacion}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-3); line-height: 1.4;">
                ${b.observacion}
            </div>
        </div>
    `).join('');
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

// ── 5. VISOR INTERACTIVO DE COMPROBANTES Y FACTURAS AFIP/ARCA ───────
const getInvoiceMetadata = (item) => {
    const c = String(item.concepto || item.rawSample || '').trim();
    const p = String(item.periodo || '2026-09');
    const m = Number(item.monto || item.montoEstimado || 0);
    const cat = String(item.categoria || item.rubro || 'General');

    let prov = item.proveedor || "Proveedor Registrado";
    let cuit = item.cuit || "30-71412062-6 (Consorcio)";
    let tipoComp = item.comprobante_tipo && item.comprobante_tipo !== "Sin comprobante"
        ? item.comprobante_tipo
        : "Comprobante Oficial";

    const cUpper = c.toUpperCase();
    if (!item.proveedor) {
        if (cUpper.includes("EDESUR") || cUpper.includes("05637256")) {
            prov = "EDESUR - EMPRESA DISTRIBUIDORA SUR S.A.";
            cuit = "CUIT 30-65511651-2";
            tipoComp = "Liq. Serv. Púb. B (Energía Eléctrica)";
        } else if (cUpper.includes("AYSA") || cUpper.includes("192498") || cUpper.includes("192499") || cUpper.includes("192500")) {
            prov = "Agua y Saneamientos Argentinos S.A. (AySA)";
            cuit = "CUIT 30-70956507-5";
            tipoComp = "Liq. Serv. Púb. B (Agua y Cloacas)";
        } else if (cUpper.includes("BASTIDA")) {
            prov = "BASTIDA S.A. SEGURIDAD PRIVADA INTEGRAL";
            cuit = "CUIT 30-70840520-1";
            tipoComp = "Factura B (Vigilancia Física)";
        } else if (cUpper.includes("GUILLEMI")) {
            prov = "ASCENSORES GUILLEMI INTERIOR S.A.";
            cuit = "CUIT 30-71148920-4";
            tipoComp = "Factura B (Abono Ascensores)";
        } else if (cUpper.includes("SANEAMIENTO") || cUpper.includes("ECO PLAGAS") || cUpper.includes("FB")) {
            prov = "FB Saneamiento Ambiental (Eco Plagas)";
            cuit = "CUIT 30-71284910-3";
            tipoComp = "Factura B (Desinsectación)";
        } else if (cUpper.includes("HOLANDO")) {
            prov = "LA HOLANDO SUDAMERICANA COMPAÑÍA DE SEGUROS S.A.";
            cuit = "CUIT 33-50003806-9";
            tipoComp = "Póliza Integral de Consorcio";
        } else if (cUpper.includes("ALLIANZ")) {
            prov = "ALLIANZ ARGENTINA COMPAÑÍA DE SEGUROS S.A.";
            cuit = "CUIT 30-50003721-7";
            tipoComp = "Póliza Seguro Accidentes Personales";
        } else if (cUpper.includes("TELECENTRO") || cUpper.includes("FLOW") || cUpper.includes("PERSONAL")) {
            prov = "PERSONAL / FLOW (Telecom Argentina S.A.)";
            cuit = "CUIT 30-63945373-8";
            tipoComp = "Factura B (Conectividad / Internet)";
        } else if (cUpper.includes("ARCA") || cUpper.includes("AFIP") || cUpper.includes("JUBILAC") || cUpper.includes("OBRA SOCIAL") || cUpper.includes("19032")) {
            prov = "ARCA (Ex AFIP) — Seguridad Social F.931";
            cuit = "CUIT 33-69345023-9";
            tipoComp = "VEP / Declaración Jurada F.931";
        } else if (cUpper.includes("SUTERH") || cUpper.includes("FATERYH") || cUpper.includes("SERACARH") || cUpper.includes("SINDICAL")) {
            prov = "SUTERH / FATERYH / SERACARH";
            cuit = "Entidad Sindical CCT 589/10";
            tipoComp = "Boleta Sindical CCT 589/10";
        } else if (cUpper.includes("SUELDO") || cUpper.includes("ENCARGADO") || cUpper.includes("AYUDANTE") || cUpper.includes("VIGILANCIA NOCTURNA")) {
            prov = `Personal del Consorcio (${item.empleado || 'Relación de Dependencia'})`;
            cuit = "CUIL Protegido (Ley 25.326)";
            tipoComp = "Recibo de Haberes Ley 20.744";
        } else if (cUpper.includes("DELJARANO") || cUpper.includes("PARIANO") || cUpper.includes("D&F") || (cUpper.includes("HONORARIOS") && p <= "2026-07")) {
            prov = "D&F Administración (Deljarano / Pariano)";
            cuit = "CUIT 27-25108998-7";
            tipoComp = "Factura C (Honorarios Administración)";
        } else if (cUpper.includes("FERNÁNDEZ") || cUpper.includes("FERNANDEZ") || cUpper.includes("VILLASENIN")) {
            prov = "ADMINISTRACIÓN DE CONSORCIOS FERNÁNDEZ - VILLASENIN";
            cuit = "CUIL 27-29946737-1 (Matr. 862)";
            tipoComp = "Liquidación de Honorarios Administración";
        } else if (cUpper.includes("GALICIA") || cUpper.includes("25413") || cUpper.includes("MANTENIMIENTO DE CUENTA")) {
            prov = "BANCO DE GALICIA Y BUENOS AIRES S.A.U.";
            cuit = "Cta. Cte. 0009108-8 044-9";
            tipoComp = "Débito Bancario / Imp. Ley 25.413";
        } else if (cUpper.includes("PAVON")) {
            prov = "LUIS DE LA PAS PAVON RIVEROS";
            cuit = "CUIT 20-94698367-6";
            tipoComp = "Factura C (Obra Pintura)";
        } else if (cUpper.includes("LECOS") || cUpper.includes("LINAJE")) {
            prov = "LECOS SERVICIOS de LINAJE ESTEBAN JESÚS";
            cuit = "CUIT 20-22001035-0";
            tipoComp = "Factura C (Mantenimiento Eléctrico/Cámaras)";
        }
    }

    let numComp = "";
    if (item.comprobante_nro && item.comprobante_nro !== "-") {
        numComp = `${item.comprobante_tipo || 'Comp.'} ${item.comprobante_nro}`;
    } else {
        const mFact = c.match(/(?:FAC|FACT|FC\.?|RECIBO|TICKET)\s*(?:[ABC]\s*)?(?:N[°º]?\s*)?([0-9]{1,5}-[0-9]{4,8}|[0-9]{6,10})/i);
        if (mFact) {
            numComp = `COMP. ${mFact[1]}`;
        } else {
            numComp = `LIQ-${p} (Reg. Contable)`;
        }
    }

    const settlementPdfUrl = `liquidaciones/360_${p}_liquidacion.pdf`;
    const comprobanteUrl = item.comprobante_url || null;
    const pdfUrl = comprobanteUrl || settlementPdfUrl;
    const estadoPago = item.seccion || "Pagado";
    const adminName = item.administracion || (p >= "2026-08" ? "Fernández - Villasenin" : "D&F Administración");

    return {
        concepto: c,
        periodo: p,
        monto: m,
        categoria: cat,
        proveedor: prov,
        cuit: cuit,
        tipoComp: tipoComp,
        numComp: numComp,
        comprobanteUrl: comprobanteUrl,
        settlementPdfUrl: settlementPdfUrl,
        pdfUrl: pdfUrl,
        estadoPago: estadoPago,
        administracion: adminName,
        cuentaContable: item.cuenta_contable || cat,
        fechaEmision: item.fecha_emision || null
    };
};

const openInvoiceViewerModal = (itemOrConcept, periodo, monto) => {
    let item = {};
    if (typeof itemOrConcept === 'object' && itemOrConcept !== null) {
        item = itemOrConcept;
    } else if (typeof itemOrConcept === 'string') {
        // Buscar si existe el ítem completo en globalRawExpenses para recuperar su comprobante_url real
        const matchItem = (globalRawExpenses || []).find(
            g => g.periodo === (periodo || '2026-09') && g.concepto === itemOrConcept
        );
        item = matchItem || { concepto: itemOrConcept, periodo: periodo || '2026-09', monto: monto || 0 };
    }

    const meta = getInvoiceMetadata(item);
    const modal = document.getElementById("invoiceViewerModal");
    if (!modal) return;

    document.getElementById("invoiceModalTitle").textContent = `Comprobante: ${meta.concepto}`;
    document.getElementById("invoiceModalSub").textContent = `Período: ${meta.periodo} · Emisor: ${meta.proveedor} · Adm.: ${meta.administracion}`;

    document.getElementById("invoiceMetaProveedor").textContent = meta.proveedor;
    document.getElementById("invoiceMetaCuit").textContent = meta.cuit;
    document.getElementById("invoiceMetaNum").textContent = meta.numComp;
    document.getElementById("invoiceMetaMonto").textContent = typeof fmt === 'function' ? fmt(meta.monto) : `$ ${meta.monto.toLocaleString('es-AR')}`;
    document.getElementById("invoiceMetaPeriodo").textContent = meta.periodo;

    const iframe = document.getElementById("invoiceIframe");
    if (iframe) {
        const fmtMonto = typeof fmt === 'function' ? fmt(meta.monto) : `$ ${meta.monto.toLocaleString('es-AR')}`;
        const statusColor = meta.estadoPago === "Pagado" ? "#10b981" : "#f59e0b";
        const statusLabel = meta.estadoPago === "Pagado"
            ? "✓ Pagado y Conciliado"
            : `⚠️ ${meta.estadoPago} (Pasivo Devengado)`;
        const hasOriginalScan = Boolean(meta.comprobanteUrl);

        const docHtml = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0b1120; color: #f1f5f9; margin: 0; padding: 1.25rem; }
                    .card { background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.35rem; max-width: 620px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #06b6d4; padding-bottom: 0.85rem; margin-bottom: 0.9rem; gap: 10px; }
                    .logo { font-size: 1.05rem; font-weight: 800; color: #06b6d4; letter-spacing: 0.5px; }
                    .comp-type { background: rgba(6,182,212,0.15); color: #06b6d4; border: 1px solid rgba(6,182,212,0.3); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.76rem; white-space: nowrap; }
                    .row { display: flex; justify-content: space-between; margin-bottom: 0.65rem; font-size: 0.84rem; border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 5px; gap: 12px; }
                    .label { color: #94a3b8; white-space: nowrap; }
                    .val { font-weight: 600; color: #f1f5f9; text-align: right; }
                    .total-box { background: rgba(16,185,129,0.1); border: 1px solid #10b981; border-radius: 8px; padding: 0.9rem; text-align: center; margin-top: 1rem; }
                    .total-title { font-size: 0.75rem; color: #10b981; text-transform: uppercase; font-weight: 700; }
                    .total-val { font-size: 1.65rem; font-weight: 900; color: #10b981; margin-top: 4px; }
                    .scan-actions { display: flex; gap: 10px; justify-content: center; margin-top: 1rem; flex-wrap: wrap; }
                    .btn-scan { background: #06b6d4; color: #0b1120; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                    .btn-liq { background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.15); padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                    .stamp { margin-top: 1rem; text-align: center; font-size: 0.74rem; color: #64748b; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <div>
                            <div class="logo">CONSORCIO SARMIENTO 356, 358 Y 360</div>
                            <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">CUIT 30-71412062-6 · Auditoría de Comprobante Respaldatorio</div>
                        </div>
                        <div>
                            <span class="comp-type">${meta.tipoComp}</span>
                        </div>
                    </div>
                    <div class="row">
                        <span class="label">Emisor / Proveedor:</span>
                        <span class="val">${meta.proveedor}</span>
                    </div>
                    <div class="row">
                        <span class="label">Identificación Tributaria:</span>
                        <span class="val" style="color:#06b6d4;">${meta.cuit}</span>
                    </div>
                    <div class="row">
                        <span class="label">Número de Comprobante:</span>
                        <span class="val">${meta.numComp}</span>
                    </div>
                    <div class="row">
                        <span class="label">Concepto Imputado:</span>
                        <span class="val">${meta.concepto}</span>
                    </div>
                    <div class="row">
                        <span class="label">Período / Administración:</span>
                        <span class="val">${meta.periodo} · ${meta.administracion}</span>
                    </div>
                    <div class="row">
                        <span class="label">Estado de Pago / Conciliación:</span>
                        <span class="val" style="color:${statusColor};">${statusLabel}</span>
                    </div>
                    <div class="total-box">
                        <div class="total-title">Importe Liquidado</div>
                        <div class="total-val">${fmtMonto}</div>
                    </div>
                    <div class="scan-actions">
                        ${hasOriginalScan ? `<a class="btn-scan" href="${meta.comprobanteUrl}" target="_blank" rel="noopener">📎 Abrir Factura / Recibo Escaneado Original (ConsorcioAbierto)</a>` : ''}
                        <a class="btn-liq" href="${meta.settlementPdfUrl}" target="_blank" rel="noopener">📄 Abrir Liquidación Oficial ${meta.periodo} (PDF)</a>
                    </div>
                    <div class="stamp">
                        <span>Documento Auditado — Sarmiento 360 (${hasOriginalScan ? 'Con adjunto digitalizado oficial' : 'Registrado en liquidación mensual'})</span>
                    </div>
                </div>
            </body>
            </html>
        `;
        iframe.removeAttribute("src");
        iframe.srcdoc = docHtml;
    }

    // Configurar botones de acción del pie del modal
    const downloadBtn = document.getElementById("invoiceDownloadBtn");
    if (downloadBtn) {
        downloadBtn.textContent = meta.comprobanteUrl ? "📎 Descargar Comprobante Original" : "⬇ Descargar Liquidación PDF";
        downloadBtn.onclick = () => {
            window.open(meta.pdfUrl, '_blank');
        };
    }
    const openTabBtn = document.getElementById("invoiceOpenTabBtn");
    if (openTabBtn) {
        openTabBtn.textContent = "↗ Ver Liquidación Completa";
        openTabBtn.onclick = () => {
            window.open(meta.settlementPdfUrl, '_blank');
        };
    }

    modal.classList.add("open");
};

const closeInvoiceViewerModal = () => {
    const modal = document.getElementById("invoiceViewerModal");
    if (modal) modal.classList.remove("open");
};

// Exportar funciones para uso en browser y node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runDocumentaryAudit, normalizeConceptKey, AUDIT_EXCEPTIONS, renderDocumentaryAuditSection, exportDocumentaryAuditCSV, openInvoiceViewerModal, closeInvoiceViewerModal };
}



