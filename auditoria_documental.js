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

// Exportar funciones para uso en browser y node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runDocumentaryAudit, normalizeConceptKey, AUDIT_EXCEPTIONS };
}
