# 📊 Sarmiento 360 — Dashboard de Expensas y Auditoría Independiente

Este es un panel de control y auditoría de expensas, gastos e infraestructura para el consorcio **Sarmiento 356-360** (Lomas de Zamora, Provincia de Buenos Aires). Se trata de una solución estática e independiente desarrollada por un copropietario para transparentar la información financiera y monitorear los servicios esenciales del edificio (70 Unidades Funcionales).

Acceso al sitio en producción: **[alexismartyniuk.com.ar/sarmiento-360](https://alexismartyniuk.com.ar/sarmiento-360)**

---

## 🚀 Arquitectura y Tecnologías
La plataforma está diseñada con una arquitectura liviana, de alto rendimiento y puramente estática para asegurar costos de infraestructura cero, máxima velocidad y seguridad frente a ataques.

* **Frontend:**
  * **HTML5 Semántico:** Estructura limpia y accesible.
  * **Vanilla CSS (Variables CSS):** Diseño responsive de alta estética premium en modo oscuro, con difuminado blur y animaciones fluidas sin dependencias pesadas.
  * **Vanilla JavaScript (ES6+):** Lógica pura para filtrado dinámico, procesamiento de datos, cálculos en vivo y control de estados de la UI.
  * **ApexCharts (CDN):** Visualizaciones interactivas de series temporales y distribución patrimonial.
* **Backend de Ingesta (Local):**
  * Scripts en **Python** (`extract_data.py` y `extract_prorrateo.py`) para procesar, limpiar y parsear los datos brutos extraídos de los PDFs y planillas auxiliares de la administración D&F hacia archivos relacionales `gastos.json` y `prorrateo.json`.
* **Monitoreo en Tiempo Real (Serverless API):**
  ---

## 🌟 Funcionalidades Destacadas

* **⚖️ Auditoría Forense y Cruces Legales (`#auditoria`):** Conciliación automática entre los prorrateos de cobranza y los extractos bancarios oficiales de Banco Galicia CC N° 0009108-8, revelando retenciones de fondos en caja, desvíos en coeficientes reglamentarios (99,79% legal vs. 100%) y el cobro ilegal plano de Seguridad Privada (1/70).
* **📈 Benchmark Oficial de Inflación INDEC (`data_ipc_indec.json`):** Integración con la API oficial de Datos Abiertos (`apis.datos.gob.ar`, serie 148.3) para contrastar el aumento de abonos y honorarios (+163,5% D&F) frente a la inflación oficial (+38,50%).
* **📝 Personalizador de Nota Formal de Reclamo (`#reclamo`):** Generador dinámico de cartas de intimación y oposición asamblearia (Art. 2060 CCyCN) con cálculo al centavo del saldo a favor por seguridad ($487k Alexis Martyniuk - UF 55 y 59), copiado al portapapeles, exportación PDF lista para firmar y envío por email a la Administración.
* **📱 Carteleras Físicas con QR Autónomo:** Diseños A4 y media hoja con código QR SVG vectorial embebido en el código para difusión vecinal 100% offline.
* **📋 Desambiguación Explícita por Torre/Dirección:** Distinción clara entre las dos torres residenciales del complejo: **Torre Sarmiento 356** y **Torre Sarmiento 360** (ej: `1°A (Sarmiento 356)` vs `1°A (Sarmiento 360)`).
* **📎 Link a Factura Digital por Renglón:** Enlaces directos `📄 Factura` en cada renglón de gastos para abrir el PDF del comprobante respaldatorio en la sección de auditoría.
* **⏰ Tablero de Vencimiento de Contratos e Inspecciones:** Cuenta regresiva con alertas semafóricas para seguros (La Holando Sudamericana y Allianz AP), mantenimiento de ascensores (Guillemi), fumigación y matafuegos.
* **📄 Certificados de U.F. en PDF:** Botón en cada Unidad Funcional para generar un certificado A4 de 1 página listo para imprimir o enviar por WhatsApp con el historial de pagos y estado de libre deuda.
* **📥 Exportaciones Masivas (XLSX / CSV):** Descarga de datasets completos anonimizados para revisión externa o contadores.
* **🔒 Anonimización Transparente:** Surnames de propietarios reemplazados por `Propietario U.F. X` y personal del consorcio identificado por su cargo oficial (`Encargado Principal`, `Encargado Auxiliar`, `Ayudante / Suplente`).

---

## 📁 Estructura del Repositorio por Dominios
> Para consultar el mapa catastral, fiduciario y notarial completo con todos los títulos y números de folio, ver **[MASTER_INDEX_SARMIENTO360.md](MASTER_INDEX_SARMIENTO360.md)**.

```
Administracion_Sarmiento360/
├── 📁 Notarial/                            # Hub Legal: Escrituras UF 55/59, Reglamentos RCP/REC y DPPJ
│   ├── README.md                           # Índice detallado del acervo notarial
│   ├── ESCRITURA SARMIENTO 10.pdf          # Título de dominio UF 55 (Alexis)
│   ├── ESCRITURA SARMIENTO 11 Y COCHERA.pdf# Título de dominio UF 59 y UC BN (Andrés)
│   ├── REGLAMENTO_DE_COPROPIEDAD_RCP.md   # OCR completo RCP (63 págs, Matr. 90.414)
│   ├── REGLAMENTO_INTERNO_REC.md          # OCR completo REC (9 págs, Asamb. 2013)
│   ├── COMPENDIO_Y_ANALISIS_JURIDICO.md    # Síntesis jurídica de cláusulas operativas
│   └── CERTIFICADO_VIGENCIA_DPPJ.png       # Constancia RPAC 862 DPPJ Ministerio Justicia PBA
│
├── 📁 Reunion de consorcio 02112026/       # Hub Asambleario: Audios, Transcripción IA y Oposiciones
│   ├── README.md                           # Guía ejecutiva del acto del 02/11/2026
│   ├── ACTA_ANALITICA_ASAMBLEA_02112026.md # Resumen fidedigno en 8 puntos del orden del día
│   ├── TRANSCRIPCION_FIDEDIGNA_ASAMBLEA... # Texto íntegro Whisper large-v3-turbo (82 min)
│   ├── AUDIO_PROBATORIO_CONFESION...mp3    # Clip probatorio 26s (confesión min 44:05)
│   ├── EMAIL_IMPUGNACION_Y_OPOSICION.md   # Escrito formal para notificar oposición legal
│   ├── Informe_reclamo_UF55_UF59_firmado.pdf# Dictamen pericial Dr. Parodi (CPCEPBA)
│   ├── 02_TABLA_SALDOS_70_DEPTOS_SEGURIDAD.pdf# Matriz de saldos 70 UFs ($6.76M de desvío)
│   ├── Informe Gasto de Pintura Exterior.pdf # Auditoría sobrecostos Morel ($6.91M + $6M)
│   ├── Factura Rex Putz 415mil.pdf         # Factura Rex $415k (aclarado en asamblea: filtración piso 14 Celina)
│   └── CARPETA_ASAMBLEA_02112026/          # Guías tácticas, guión paso a paso e impresiones
│
├── 📁 docs_auditoria/                      # Documentos públicos accesibles vía web (PDF / PNG / MP3)
│   ├── README.md                           # Índice de recursos expuestos al dashboard
│   ├── CERTIFICADO_VIGENCIA_DPPJ_ADMIN...  # Imagen oficial DPPJ accesible vía modal
│   ├── Informe_reclamo_UF55_UF59_firmado.pdf# Descarga directa del dictamen pericial
│   ├── TABLA_SALDOS_70_DEPTOS_SEGURIDAD.pdf # Descarga de planilla de saldos de las 70 UFs
│   └── AUDIO_PROBATORIO_CONFESION...mp3    # Reproductor HTML5 nativo del dashboard
│
├── 📁 liquidaciones/                       # Repositorio de 14 liquidaciones oficiales en PDF (2025-07 a 2026-09)
├── 📁 FC Adm/                              # Facturas fiscales de honorarios de administración
│
├── 🌐 PLATAFORMA WEB Y CARTELERA (ROOT)
│   ├── index.html                          # Panel de Control General y Cuadro Ejecutivo
│   ├── dashboard.js                        # Lógica interactiva, filtros y gráficos de gastos
│   ├── unidades.html                       # Módulo de Expensas por Unidad Funcional
│   ├── unidades.js                         # Prorrateo, mora, alícuotas y cálculo de seguridad
│   ├── auditoria-documentos.html           # Módulo de Auditoría Documental y Gastos Omitidos
│   ├── auditoria-documentos.js             # Detección de omisiones y comprobantes faltantes
│   ├── auditoria_documental.js             # Módulo compartido de auditoría de Ley 14701
│   ├── cartelera_dashboard.html            # Cartelera mensual digital e imprimible
│   └── cartelera_dashboard_media_hoja.html # Cartelera compacta de media hoja
│
├── 📊 BASES DE DATOS (JSON)
│   ├── gastos.json                         # Historial consolidado de gastos y proveedores
│   ├── prorrateo.json                      # Padrón de 70 UFs con historial de liquidación
│   ├── servicios_status.json               # Estado en vivo de Edesur, AySA y Metrogas
│   └── datos_escrituras_martyniuk.json     # Catastro y parámetros de las UFs familiares
│
├── ⚙️ PIPELINE DE INGESTA Y AUTOMATIZACIONES
│   ├── cron_update.py                      # Cron job para chequeo y sincronización periódica
│   ├── check_servicios.py                  # Consulta directa a prestadoras públicas
│   ├── ingest_consorcioabierto.py          # Extracción y parsing desde ConsorcioAbierto
│   ├── download_historico.py               # Descarga de comprobantes históricos
│   ├── extract_data.py                     # Extracción y conciliación de gastos
│   └── extract_prorrateo.py                # Extracción y cálculo de prorrateo
│
└── 📋 DOCUMENTACIÓN RAÍZ
    ├── README.md                           # Documentación principal
    ├── MASTER_INDEX_SARMIENTO360.md        # Mapa Maestro y Catastral del Repositorio
    ├── DOCUMENTACION_LEGAL_PROPIEDADES...md# Escrituras y parámetros catastrales en detalle
    ├── ADMINISTRADORA_VIGENCIA_OFICIAL.md  # Dictamen de personería DPPJ Ley 14701
    └── especificacion_tecnica.md           # Arquitectura técnica, modelos y schemas
```

---

## 🛠️ Instalación y Ejecución Local

Para ejecutar el proyecto localmente sin instalar dependencias:

1. Clonar el repositorio.
2. Iniciar un servidor web local en el puerto `8000` desde la raíz del proyecto para evitar restricciones de políticas CORS al cargar los archivos JSON:
   ```bash
   python -m http.server 8000
   ```
3. Abrir el navegador e ingresar a: `http://localhost:8000`

---

## 🔄 Integración Continua, Calendarización e Ingesta (GitHub Actions)

El proyecto cuenta con un workflow de automatización y despliegue configurado en **[.github/workflows/deploy.yml](file:///.github/workflows/deploy.yml)**.

### 📅 Cron Jobs Programados (Hora de Argentina / UTC)
El pipeline en la nube ejecuta tareas programadas utilizando la zona horaria UTC:

1. **Monitoreo de Suministros (Luz, Agua y Gas):**
   * **Horarios Locales (Arg):** Todos los días a las **06:00, 12:00, 18:00 y 21:00 hs**.
   * **Calendarización Cron:** `0 0,9,15,21 * * *` (UTC).
   * **Modo:** `--services-only` (actualiza únicamente los estados del widget).
2. **Descarga y Extracción de Expensas:**
   * **Horarios Locales (Arg):** Del **día 1 al 5 de cada mes a las 18:00 hs**.
   * **Calendarización Cron:** `0 21 1-5 * *` (UTC).
   * **Modo:** `--all` (ejecuta el barrido predictivo de PDFs y regenera la base de datos).

### 🤖 Coordinador de Actualización (`cron_update.py`)
El script centralizador de actualización controla de forma inteligente la descarga de expensas:
* Calcula automáticamente cuál es el período vencido esperado (ej: en Julio busca la expensa de Junio / `2026-06`).
* Comprueba en `gastos.json` si el período esperado ya tiene registros.
  * **Si ya tiene datos:** Detiene el flujo de descarga de forma inmediata para evitar consumos redundantes del portal de la administración.
  * **Si no tiene datos:** Ejecuta `ingest_consorcioabierto.py`, `build_ipc_data.py` y `generate_forensic_audit.py` para sincronizar `gastos.json`, `prorrateo.json`, `data_ipc_indec.json` y `forensic_audit.json`.

### 💾 Persistencia Automática de Cambios
Si tras la ejecución del cron se detecta que cambió el estado de los servicios locales o se integró una nueva expensa:
1. El workflow de GitHub Actions realiza un commit automático de vuelta a la rama `main` para guardar la información histórica en Git.
2. Despliega la versión actualizada del sitio estático en la rama `gh-pages`.
3. Vercel sirve de forma directa el contenido actualizado en la subruta de producción.
