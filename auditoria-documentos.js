// Helper para resolver archivos JSON relativos sin importar si la URL tiene slash final o no
const getRelativeDataUrl = (file) => {
    let path = window.location.pathname;
    if (!path.endsWith("/") && !path.endsWith(".html")) {
        path += "/";
    }
    return new URL(file, window.location.origin + path).href;
};

let allGastos = [];
let filteredGastos = [];

document.addEventListener("DOMContentLoaded", () => {
    loadGastosData();
});

async function loadGastosData() {
    try {
        const response = await fetch(getRelativeDataUrl("gastos.json"));
        const data = await response.json();
        allGastos = (data.gastos || []).filter(g => g.monto && g.monto > 0);

        const totalEl = document.getElementById("docTotalCount");
        if (totalEl) {
            const withDirectPdf = allGastos.filter(g => g.comprobante_url).length;
            totalEl.textContent = `${allGastos.length} (${withDirectPdf} PDF)`;
        }
        const sideEl = document.getElementById("sidebarPeriods");
        if (sideEl) {
            sideEl.textContent = `${allGastos.length} Comprobantes Auditados`;
        }

        populatePeriodFilter();
        setupEventListeners();
        applyFilters();
        if (typeof renderDocumentaryAuditSection === 'function') {
            renderDocumentaryAuditSection(data.gastos || []);
        }
    } catch (err) {
        console.error("Error al cargar gastos.json:", err);
    }
}

function populatePeriodFilter() {
    const periodSelect = document.getElementById("docPeriodFilter");
    if (!periodSelect) return;

    const periods = [...new Set(allGastos.map(g => g.periodo))].sort().reverse();
    periodSelect.innerHTML = '<option value="todos">Todos los períodos (14 meses)</option>';
    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p >= "2026-08" ? `${p} (ConsorcioAbierto)` : `${p} (D&F)`;
        periodSelect.appendChild(opt);
    });
}

function setupEventListeners() {
    const searchInput = document.getElementById("docSearchInput");
    const periodSelect = document.getElementById("docPeriodFilter");
    const typeSelect = document.getElementById("docTypeFilter");

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    if (periodSelect) periodSelect.addEventListener("change", applyFilters);
    if (typeSelect) typeSelect.addEventListener("change", applyFilters);
}

function getDocType(g) {
    const cat = g.categoria || g.rubro || "";
    const c = (g.concepto || "").toLowerCase();

    if (cat === "Sueldos y Cargas Sociales") {
        return "Boleta Sueldo / F.931";
    }
    if (cat === "Administración" && (c.includes("25413") || c.includes("banco") || c.includes("mantenimiento de cuenta") || c.includes("comision") || c.includes("comisión") || c.includes("impuesto ley"))) {
        return "Extracto Bancario / Transf.";
    }
    if (cat === "Seguros" || c.includes("poliza") || c.includes("póliza") || c.includes("integral de consorcio")) {
        return "Contrato / Póliza";
    }
    return "Factura B/C AFIP";
}

function getDocNumber(g) {
    if (g.comprobante_nro && g.comprobante_nro !== "-") {
        return `${g.comprobante_tipo || 'Comp.'} ${g.comprobante_nro}`;
    }
    const c = g.concepto || "";
    if (c.includes("FACT")) {
        const parts = c.split("FACT");
        return "FACT " + parts[1].trim().split(" ")[0];
    }
    if (c.includes("FAC")) {
        const parts = c.split("FAC");
        return "FAC " + parts[1].trim().split(" ")[0];
    }
    if (c.includes("NRO")) {
        const parts = c.split("NRO");
        return "N° " + parts[1].trim().split(" ")[0];
    }
    if (g.categoria === "Sueldos y Cargas Sociales") {
        return "F.931 ARCA / Recibo";
    }
    if (c.includes("25413") || c.includes("banco") || c.includes("mantenimiento de cuenta")) {
        return "Débito Banco Galicia";
    }
    return "Reg. Liquidación";
}

function applyFilters() {
    const search = (document.getElementById("docSearchInput")?.value || "").toLowerCase();
    const period = document.getElementById("docPeriodFilter")?.value || "todos";
    const docType = document.getElementById("docTypeFilter")?.value || "todos";

    filteredGastos = allGastos.filter(g => {
        const matchesSearch = !search ||
            (g.concepto || "").toLowerCase().includes(search) ||
            (g.categoria || "").toLowerCase().includes(search) ||
            (g.proveedor || "").toLowerCase().includes(search) ||
            (g.comprobante_nro || "").toLowerCase().includes(search);
        const matchesPeriod = period === "todos" || g.periodo === period;
        const matchesType = docType === "todos" || getDocType(g) === docType;
        return matchesSearch && matchesPeriod && matchesType;
    });

    // Ordenar más recientes primero
    filteredGastos.sort((a, b) => b.periodo.localeCompare(a.periodo));
    renderTable();
}

function formatARS(val) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(val || 0);
}

function openDocViewerByIndex(idx) {
    const item = filteredGastos[idx];
    if (item && typeof openInvoiceViewerModal === "function") {
        openInvoiceViewerModal(item);
    }
}

function renderTable() {
    const tbody = document.getElementById("docTableBody");
    const countLabel = document.getElementById("docPaginationInfo");
    if (!tbody) return;

    if (filteredGastos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:2rem;">No se encontraron comprobantes con los filtros seleccionados.</td></tr>';
        if (countLabel) countLabel.textContent = "0 comprobantes encontrados";
        return;
    }

    if (countLabel) {
        countLabel.textContent = `Mostrando ${filteredGastos.length} comprobantes de respaldo auditados (clic en cualquier fila para abrir el visor)`;
    }

    tbody.innerHTML = filteredGastos.map((g, idx) => {
        const docType = getDocType(g);
        const docNum = getDocNumber(g);
        const cat = g.categoria || g.rubro || "General";

        let typeBadgeClass = "badge-blue";
        if (docType.includes("Sueldo")) typeBadgeClass = "badge-amber";
        if (docType.includes("Extracto")) typeBadgeClass = "badge-purple";
        if (docType.includes("Contrato")) typeBadgeClass = "badge-success";

        const hasScan = Boolean(g.comprobante_url);
        const isPending = g.seccion && g.seccion !== "Pagado";

        const respaldoBadge = hasScan
            ? `<span class="badge badge-success" title="Adjunto escaneado original disponible en ConsorcioAbierto">📎 PDF Escaneado</span>`
            : `<span class="badge badge-blue">✓ Reg. Liquidación</span>`;

        const actionBtn = `<button class="btn" onclick="event.stopPropagation(); openDocViewerByIndex(${idx})" style="padding:3px 9px; font-size:0.72rem; background:${hasScan ? 'rgba(16,185,129,0.15)' : 'rgba(6,182,212,0.12)'}; border-color:${hasScan ? '#10b981' : 'var(--accent)'}; color:${hasScan ? '#34d399' : 'var(--accent)'};">${hasScan ? '📎 Ver PDF Original' : '🔍 Ver Ficha'}${isPending ? ' ⚠️' : ''}</button>`;

        return `
            <tr style="cursor:pointer;" onclick="openDocViewerByIndex(${idx})">
                <td><strong style="color:var(--text-1);">${g.periodo}</strong></td>
                <td>${cat}</td>
                <td><span class="badge ${typeBadgeClass}">${docType}</span></td>
                <td><code style="color:var(--accent); font-family:monospace;">${docNum}</code></td>
                <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis;" title="${g.concepto}">${g.concepto}</td>
                <td style="text-align:right; font-weight:700; color:var(--text-1);">${formatARS(g.monto)}</td>
                <td style="text-align:center;">${respaldoBadge}</td>
                <td style="text-align:center;">${actionBtn}</td>
            </tr>
        `;
    }).join("");
}

function exportDocCSV() {
    if (filteredGastos.length === 0) return alert("No hay datos para exportar.");
    let csv = "Periodo,Administracion,Categoria,Tipo_Documento,Numero_Comprobante,Concepto_Proveedor,Monto,Estado_Pago,URL_Comprobante\n";
    filteredGastos.forEach(g => {
        const docType = getDocType(g);
        const docNum = getDocNumber(g);
        const conceptoClean = `"${(g.concepto || '').replace(/"/g, '""')}"`;
        const adminClean = `"${(g.administracion || 'D&F').replace(/"/g, '""')}"`;
        const urlClean = `"${(g.comprobante_url || '').replace(/"/g, '""')}"`;
        csv += `${g.periodo},${adminClean},"${g.categoria || g.rubro}","${docType}","${docNum}",${conceptoClean},${g.monto},"${g.seccion || 'Pagado'}",${urlClean}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Auditoria_Documentos_Sarmiento360_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

function exportDocXLSX() {
    if (typeof XLSX === 'undefined') {
        alert("La librería SheetJS está cargando. Reintente en un momento.");
        return;
    }
    if (filteredGastos.length === 0) return alert("No hay datos para exportar.");

    const dataRows = filteredGastos.map(g => ({
        "Período": g.periodo,
        "Administración": g.administracion || (g.periodo >= "2026-08" ? "Fernández - Villasenin" : "D&F"),
        "Categoría": g.categoria || g.rubro,
        "Tipo Documento": getDocType(g),
        "N° Comprobante / CAE": getDocNumber(g),
        "Concepto / Emisor": g.concepto,
        "Monto ($)": g.monto,
        "Estado Pago": g.seccion || "Pagado",
        "Comprobante Escaneado URL": g.comprobante_url || `liquidaciones/360_${g.periodo}_liquidacion.pdf`
    }));

    const ws = XLSX.utils.json_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comprobantes Auditados");

    XLSX.writeFile(wb, `Auditoria_Documental_Sarmiento360_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// Exportar Informe Completo Multisolapa Excel (.xlsx)
function exportFullAuditXLSX() {
    if (typeof XLSX === 'undefined') {
        alert("La librería para exportar Excel se está cargando. Por favor, reintente en unos segundos.");
        return;
    }

    const wb = XLSX.utils.book_new();

    // Hoja 1: Checklist Traspaso y Cese de Mandato D&F -> Fernández - Villasenin
    const checklistData = [
        { "Ítem Verificación": "1. Libro de Actas de Asamblea", "Área": "Legal / Consorcio", "Estado": "✓ Auditado", "Detalle": "Acta de cese D&F y designación de Adm. Fernández - Villasenin (Matr. 862)." },
        { "Ítem Verificación": "2. Conciliación Cuenta Banco Galicia", "Área": "Contable / Bancos", "Estado": "✓ Verificado 100%", "Detalle": "CC 0009108-8 044-9 · CBU 0070044320000009108891 · Alias SARMIENTO356.58.60." },
        { "Ítem Verificación": "3. Pago de Deudas Devengadas en Julio 2026", "Área": "Transición Financiera", "Estado": "✓ Abonado en Ago-26", "Detalle": "$ 15.297.607,28 cancelados en agosto (ARCA $ 6.20M, Bastida $ 4.32M, Sueldos $ 3.20M, SUTERH $ 506k)." },
        { "Ítem Verificación": "4. Clave Fiscal ARCA y Deuda Heredada", "Área": "Fiscal / Previsional", "Estado": "⚠️ En Reclamo", "Detalle": "Saldo ARCA Jul-26 impago ($ 1.571.590,83) + estimado Sep-26 ($ 1.600.000) por falta de acceso a clave fiscal ARCA." },
        { "Ítem Verificación": "5. Pólizas de Seguro Edilicio y AP", "Área": "Seguros", "Estado": "✓ Vigentes", "Detalle": "La Holando Sudamericana ($ 341.929,35/mes) y Allianz AP ($ 15.533/mes)." },
        { "Ítem Verificación": "6. Abono de Ascensores (Guillemi)", "Área": "Contratos / Mantenimiento", "Estado": "✓ Verificado", "Detalle": "Mantenimiento preventivo mensual Torres 356, 358 y 360 ($ 146.400/mes)." },
        { "Ítem Verificación": "7. Contrato de Seguridad (Bastida S.A.)", "Área": "Seguridad", "Estado": "✓ Verificado", "Detalle": "Vigilancia física 24hs - Fc. B 0004-00000979 ($ 4.485.421,20 en Sep-26)." },
        { "Ítem Verificación": "8. Plataforma ConsorcioAbierto SRL", "Área": "Sistemas / Gestión", "Estado": "✓ Activa", "Detalle": "Consorcio ID 27151 con adjuntos digitales de facturas y recibos de sueldo." }
    ];
    const wsChecklist = XLSX.utils.json_to_sheet(checklistData);
    wsChecklist['!cols'] = [{ wch: 42 }, { wch: 25 }, { wch: 20 }, { wch: 75 }];
    XLSX.utils.book_append_sheet(wb, wsChecklist, "Protocolo Traspaso");

    // Hoja 2: Matriz Completa de Comprobantes Auditados
    const dataRows = allGastos.map(g => ({
        "Período": g.periodo,
        "Administración": g.administracion || (g.periodo >= "2026-08" ? "Fernández - Villasenin" : "D&F"),
        "Categoría": g.categoria || g.rubro,
        "Tipo Documento": getDocType(g),
        "N° Comprobante / CAE": getDocNumber(g),
        "Concepto / Emisor": g.concepto,
        "Monto ($)": g.monto,
        "Estado Pago": g.seccion || "Pagado",
        "URL Comprobante": g.comprobante_url || `liquidaciones/360_${g.periodo}_liquidacion.pdf`
    }));
    const wsDocs = XLSX.utils.json_to_sheet(dataRows);
    wsDocs['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 65 }, { wch: 15 }, { wch: 18 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, wsDocs, "Comprobantes Auditados");

    // Hoja 3: Contratos Vigentes (Actualizados a Sep 2026)
    const contractsData = [
        { "Proveedor / Prestador": "BASTIDA S.A. SEGURIDAD PRIVADA INTEGRAL", "CUIT": "30-70840520-1", "Servicio": "Vigilancia Física Horas Diurnas / Nocturnas", "Último Comprobante": "Fc. B 0004-00000979 (Sep-26)", "Monto Mensual": 4485421.20, "Estado": "Pagado" },
        { "Proveedor / Prestador": "EDESUR S.A. (Cliente 05637256)", "CUIT": "30-65511651-2", "Servicio": "Energía Eléctrica Partes Comunes (3789 kWh)", "Último Comprobante": "Liq. B 0501-89050415 (Sep-26)", "Monto Mensual": 1264540.08, "Estado": "Pagado" },
        { "Proveedor / Prestador": "AySA (Medidores 192498 / 499 / 500)", "CUIT": "30-70956507-5", "Servicio": "Agua Potable y Cloacas Edificio", "Último Comprobante": "Liq. Sep-26 (3 cuentas)", "Monto Mensual": 2081629.44, "Estado": "Pagado" },
        { "Proveedor / Prestador": "ADM. FERNÁNDEZ - VILLASENIN", "CUIT": "27-29946737-1", "Servicio": "Honorarios Administración Consorcio (Matr. 862)", "Último Comprobante": "Liq. Sep-26", "Monto Mensual": 830000.00, "Estado": "Pago Parcial ($70k pend.)" },
        { "Proveedor / Prestador": "LA HOLANDO SUDAMERICANA SEGUROS S.A.", "CUIT": "33-50003806-9", "Servicio": "Seguro Integral de Consorcio", "Último Comprobante": "Cuota Sep-26", "Monto Mensual": 341929.35, "Estado": "Pagado" },
        { "Proveedor / Prestador": "ASCENSORES GUILLEMI INTERIOR S.A.", "CUIT": "30-71148920-4", "Servicio": "Conservación Ascensores Torres 356/358/360", "Último Comprobante": "Fc. 0002-00026453", "Monto Mensual": 146400.00, "Estado": "Vigente" },
        { "Proveedor / Prestador": "CONSORCIO ABIERTO SRL", "CUIT": "30-71527826-6", "Servicio": "Licencia Sistema de Gestión y Liquidación", "Último Comprobante": "Fc. B 0006-00103633 (Sep-26)", "Monto Mensual": 66193.05, "Estado": "Pagado" },
        { "Proveedor / Prestador": "PERSONAL / FLOW", "CUIT": "30-63945373-8", "Servicio": "Abono Internet Portería / Cámaras", "Último Comprobante": "Abono Sep-26", "Monto Mensual": 43878.00, "Estado": "Pagado" }
    ];
    const wsContracts = XLSX.utils.json_to_sheet(contractsData);
    wsContracts['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 42 }, { wch: 28 }, { wch: 16 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsContracts, "Fichas Contratos Vigentes");

    const filename = `Informe_Auditoria_Documental_Sarmiento360_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// Imprimir / Guardar Informe PDF
function exportDocPDF() {
    window.print();
}
