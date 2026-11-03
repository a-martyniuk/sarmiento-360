# Especificación Técnica — Plataforma de Auditoría y Transparencia Sarmiento 360

## 1. Identidad del Sistema y Dominio Auditado

- **Consorcio**: Consorcio de Propietarios Edificio Sarmiento 356, 358 y 360 (Lomas de Zamora, Provincia de Buenos Aires)
- **CUIT Consorcio**: `30-71412062-6` · **Matrícula RPI**: `90.414` · **Unidades Funcionales**: `70 UFs` (Torres 356 y 360 + Cocheras 358)
- **Cuenta Bancaria Exclusiva**: Banco Galicia CC `0009108-8 044-9` · CBU `0070044320000009108891` · Alias `SARMIENTO356.58.60`
- **Administración Actual (desde 2026-08)**: **Agostina Daniela Fernández** (*Fernández - Villasenin Administradores de Consorcios*, Matrícula RPAC PBA N° `862`, Legajo `279455`, CUIT `27-29946737-1`, ConsorcioAbierto ID `27151`)
- **Administración Saliente (hasta 2026-07)**: **D&F Administración** (cese de mandato: `20/08/2026`)
- **Perito Contable Actuante**: **Dr. Pablo Américo Parodi**, Contador Público (`T° 178 F° 152 · Legajo 46351/5 C.P.C.E.P.B.A.`, CUIT `20-32651171-5`)
- **URL en Producción**: `https://www.alexismartyniuk.com.ar/sarmiento-360/`

---

## 2. Arquitectura "Zero-Backend" + Pipeline GitOps

El sistema opera 100% de manera estática (HTML5 + CSS3 + Vanilla JS + ApexCharts + SheetJS) sobre Vercel / GitHub Pages, alimentado por un pipeline determinístico en Python con codificación `UTF-8` estricta:

```text
liquidaciones/360_YYYY-MM_liquidacion.pdf (14 períodos: 2025-07 a 2026-09, sin 2025-10 no emitido en archivo D&F)
        │
        ├──► extract_data.py ──────────────► Base histórica D&F (2025-07 a 2026-07) + Fondo de Reserva
        ├──► ingest_consorcioabierto.py ───► Unificación ConsorcioAbierto (ID 27151, 2026-08+)
        │                                    Genera: gastos.json (394 gastos, 14 balances, 26 extraordinarios)
        │                                            prorrateo.json (980 registros = 14 períodos x 70 UFs)
        ├──► build_ipc_data.py ────────────► data_ipc_indec.json (serie oficial IPC-INDEC)
        ├──► generate_forensic_audit.py ───► forensic_audit.json (Pericia Seguridad 70 UFs, Conciliación Galicia, Morel, Rex, IPC)
        └──► check_servicios.py ───────────► servicios_status.json (Edesur Cta. 05637256, AySA Ctas. 192498/499/500, Metrogas)
```

Orquestador automatizado: `cron_update.py` ejecutado por `.github/workflows/deploy.yml` (4 corridas diarias para servicios públicos y sincronización mensual completa durante la ventana de publicación).

---

## 3. Módulos Frontend y Resolución de Subruta Proxy

Todas las peticiones de datos en el navegador utilizan `getRelativeDataUrl("<archivo>.json")` para garantizar compatibilidad exacta tanto en raíz local como bajo el prefijo inverso `/sarmiento-360/`:

1. **`index.html` + `dashboard.js` + `auditoria_documental.js`**:
   - KPIs financieros mensuales con detección explícita del salto `2025-09 → 2025-11` (por ausencia de PDF `2025-10` en archivo D&F).
   - Evolución por rubros, costos laborales anonimizados por rol (Ley 25.326), estado del Fondo de Reserva / Extraordinarios y ranking de morosidad multi-período.
   - Sección de **Auditoría Forense Contable y Legal (`#auditoria`)** respaldada por `forensic_audit.json`:
     - Prorrateo ilegal de Seguridad Privada en 70 partes iguales (`1,4286%`) vs. Art. 8 RCP y Art. 2049 CCyCN (`$ 6.765.131,67` transferidos en 26 meses desde 42 UFs perjudicadas hacia unidades de mayor superficie).
     - Obra de fachada frente (**Rafael Morel**): `9` pagos bancarios verificados por `$ 20.110.000,00` (`$ 6.910.000,00` sobre los `$ 13.200.000,00` presupuestados; `5` pagos sin factura y `4` vía tercero monotributista Ignacio Villalba Giménez; reclamo adicional de `$ 6.023.238,00` rechazado en Asamblea `02/11/2026`).
     - Aclaración de Asamblea `02/11/2026` sobre **Pinturerías Rex** (`FC B 7001-00005828` del `28/07/2025` por `$ 415.621,11`): imputada a filtración estructural de terraza sobre `UF 69` (`14°A Torre 356`, Celina Velayos).
   - **Generador Interactivo de Nota Formal de Reclamo (`#reclamo`)**: personalizable para cualquiera de las 70 UFs o reclamo consolidado `UF 55 + UF 59` (`$ 487.749,34` certificados).

2. **`unidades.html` + `unidades.js`**:
   - Matriz histórica de las 70 Unidades Funcionales con mapeo canónico inmutable `UF ↔ Piso/Depto/Torre`.
   - Auditoría automática de suma de coeficientes ordinarios (`Gastos A`) y alerta sobre `Gastos B / D` (Seguridad al `1/70`).
   - Modal individual de cuenta corriente por UF con tarjeta pericial certificada (`forensic_audit.json`), exportación CSV/XLSX y emisión de certificado imprimible en PDF.

3. **`auditoria-documentos.html` + `auditoria-documentos.js` + `auditoria_documental.js`**:
   - Inventario auditable de los `394` comprobantes registrados y enlaces directos a los PDFs originales escaneados en ConsorcioAbierto (`2026-08` y `2026-09`).
   - Cumplimiento Ley 14.701 PBA (RPAC Matrícula `862`), estado de libros obligatorios, checklist de traspaso D&F → Fernández - Villasenin y fichas de contratos vigentes.

4. **`cartelera_dashboard.html` y `cartelera_dashboard_media_hoja.html`**:
   - Afiches A4 y doble media hoja A5 listos para impresión con código QR hacia `alexismartyniuk.com.ar/sarmiento-360/`.
