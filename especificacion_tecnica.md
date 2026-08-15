# Especificación Técnica Completa — Sarmiento 360
### Reconstrucción de la especificación original del proyecto

> Generado mediante ingeniería inversa del código fuente. Cada sección indica si la información es **✅ Confirmada** (código explícito), **🔍 Inferida** (deducida del comportamiento del código) o **❓ Indeterminada** (no puede determinarse).

---

## 1. Objetivo del Sistema

**✅ Confirmado** — El sistema es un **panel de control y auditoría de expensas** para el consorcio propietario del edificio ubicado en **Av. Sarmiento 360, Lomas de Zamora, Provincia de Buenos Aires, Argentina**.

Desarrollado por un **copropietario de manera independiente** con el propósito de transparentar la información financiera del consorcio y monitorear los servicios esenciales del edificio en tiempo real.

Acceso en producción: **https://alexismartyniuk.com.ar/sarmiento-360**

---

## 2. Problema que Resuelve

**✅ Confirmado / 🔍 Inferido** — El sistema resuelve los siguientes problemas:

1. **Opacidad en la información financiera**: Las liquidaciones de expensas se entregan en formato PDF por la administración (Administración Global). No existía una forma de consultar el historial de gastos en forma digital, interactiva o comparativa.

2. **Ausencia de alertas de irregularidades**: No había un mecanismo para detectar facturas faltantes, aumentos inusuales o desvíos inflacionarios en los gastos del consorcio.

3. **Falta de seguimiento de personal**: No había forma de consolidar el costo mensual de cada empleado del edificio de manera independiente de la liquidación impresa.

4. **Desconocimiento del estado de servicios públicos**: Los copropietarios no tenían acceso rápido al estado de los suministros esenciales (Edesur, AySA, Metrogas) para la zona del edificio.

5. **Sin auditoría comparativa**: No existía manera de comparar el aumento de las tarifas de proveedores contra la inflación oficial (IPC-INDEC).

---

## 3. Alcance

**✅ Confirmado**

| Módulo | Estado |
|---|---|
| Dashboard general de gastos del consorcio | En producción |
| Dashboard de prorrateo por Unidad Funcional (70 U.F.) | En producción |
| Desambiguación explícita por Torre/Dirección (Sarmiento 356 vs 360) | En producción |
| Extracción automática de datos desde PDFs | En producción |
| Monitoreo de servicios públicos (Luz, Agua, Gas) | En producción |
| Comparación inflacionaria vs. IPC-INDEC | En producción |
| Detección automática de facturas faltantes | En producción |
| Detección de anomalías estadísticas en gastos | En producción |
| Auditoría de tarifas de proveedores fijos | En producción |
| Tablero de Vencimiento de Contratos e Inspecciones | En producción |
| Links a Facturas Digitales por Renglón (`📄 Factura`) | En producción |
| Generación de Certificados / Fichas Resumen de U.F. en PDF | En producción |
| Exportación Masiva a Excel (XLSX) y CSV | En producción |
| Anonimización de Nombres de Propietarios y Empleados por Cargo | En producción |
| Registro de multas por U.F. | En producción |
| Flyers imprimibles para cartelera física | En producción |

**🔍 Inferido** — El alcance excluye explícitamente:
- Otro edificio (el código hardcodea `consorcio=326`, `edificio=151`)
- Gestión contable o emisión de recibos
- Autenticación / roles de usuario
- Backend propio (100% estático + GitHub Actions)

---

## 4. Casos de Uso

**✅ Confirmado** — Se identifican los siguientes actores y casos de uso:

### Actor Principal: Copropietario (Usuario Final)
| CU | Descripción |
|---|---|
| CU-01 | Ver resumen de gastos del período actual o histórico con KPIs |
| CU-02 | Filtrar gastos por período, categoría o texto libre |
| CU-03 | Ver el desglose de gastos en gráficos históricos interactivos |
| CU-04 | Comparar los gastos de cada categoría vs. mes anterior y el IPC |
| CU-05 | Ver alertas de gastos con desviación estadística anómala |
| CU-06 | Ver alertas de facturas faltantes en los últimos 6 meses |
| CU-07 | Auditar el aumento de tarifas de proveedores vs. inflación anual |
| CU-08 | Ver el estado actual de los servicios públicos (luz, agua, gas) |
| CU-09 | Ver el detalle histórico de pagos por U.F. (expensas individuales) |
| CU-10 | Ver multas aplicadas por período o históricamente |
| CU-11 | Ver los sueldos y cargas sociales del personal del edificio |
| CU-12 | Exportar datos filtrados a CSV o PDF |
| CU-13 | Clicar en un concepto y ver todo el historial del proveedor |
| CU-14 | Ver el patrimonio neto y disponibilidades líquidas del consorcio |

### Actor Secundario: GitHub Actions (Sistema Automatizado)
| CU | Descripción |
|---|---|
| CU-15 | Descarga automática de nuevas liquidaciones PDF desde el portal de la administración |
| CU-16 | Extracción y parseo automático de los PDFs descargados |
| CU-17 | Actualización periódica del estado de servicios públicos |
| CU-18 | Commit automático de los datos actualizados al repositorio |

---

## 5. Flujo Funcional

**✅ Confirmado**

```
┌──────────────────────────────────────────────────────────────────────┐
│                    PIPELINE DE INGESTA (GitHub Actions)              │
│                                                                      │
│  CRON diario (4x/día)          CRON mensual (días 1–5)              │
│  ┌──────────────────────┐      ┌────────────────────────────────┐   │
│  │ check_servicios.py   │      │ 1. download_historico.py       │   │
│  │ ↓ scraping ENRE/AySA/│      │    (barrido predictivo en      │   │
│  │   Metrogas            │      │     paralelo, 20 hilos)        │   │
│  │ ↓ servicios_status   │      │ 2. extract_data.py             │   │
│  │   .json actualizado  │      │    (pdfplumber → gastos.json)  │   │
│  └──────────────────────┘      │ 3. extract_prorrateo.py        │   │
│                                │    (pdfplumber → prorrateo.json│   │
│                                └────────────────────────────────┘   │
│                      ↓ git commit + push → main                     │
│                      ↓ Vercel detecta push y re-despliega            │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser del Usuario)                  │
│                                                                      │
│  index.html carga              unidades.html carga                  │
│  ↓ dashboard.js                ↓ unidades.js                        │
│  ↓ fetch("gastos.json")        ↓ fetch("prorrateo.json")            │
│  ↓ fetch(API INDEC IPC)        ↓ fetch("servicios_status.json")     │
│  ↓ fetch("servicios_status     ↓ Render tabla por U.F.              │
│       .json")                                                        │
│  ↓ Render KPIs, Charts,                                             │
│    Tablas, Auditoría                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Reglas de Negocio

**✅ Confirmado** salvo donde se indica.

### RN-01: Taxonomía de Categorías de Gastos
Los gastos se clasifican en exactamente **7 categorías**, que replican los rubros de los PDF de liquidaciones:

| ID | Nombre | Tipo |
|---|---|---|
| 1 | Sueldos y Cargas Sociales | Fijo |
| 2 | Seguros | Fijo |
| 3 | Servicios Públicos | Fijo |
| 4 | Contratos y Abonos | Fijo |
| 5 | Administración | Fijo |
| 6 | Mantenimiento y Reparaciones | Variable |
| 7 | Varios | Variable |

**🔍 Inferido** — La distinción entre "Fijo" y "Variable" codificada en `extract_data.py` es:
- **Fijo**: Categorías 1-5 (se esperan mensualmente)
- **Variable**: Categorías 6-7 (según necesidad)

### RN-02: Anomalía Estadística en Gastos
Un gasto se marca como **Anomalía** si:
- Su monto supera **1.45× el promedio móvil de las últimas 3 ocurrencias** del mismo concepto
- El promedio histórico del concepto supera **$10.000 ARS** (filtro de ruido)
- El concepto **NO es SAC/Aguinaldo** (que naturalmente es el doble del sueldo mensual)

Este cálculo se realiza tanto en el backend (`detect_anomalies()` en `extract_data.py`) como se recalcula en el frontend al cargar el JSON.

### RN-03: Detección de Facturas Faltantes
Se auditan **8 servicios recurrentes** en los **6 meses anteriores al último período cargado** (se excluye el mes más reciente para evitar falsos positivos):

1. AySA - Cuenta 141117
2. AySA - Cuenta 141118
3. Metrogas
4. Edesur
5. Abono Ascensores
6. Abono Fumigación
7. Seguro Consorcio
8. Telecentro (SUM)

**Excepción explícita**: El Seguro Consorcio (Allianz) se **omite en los meses de abril y mayo**, ya que el contrato se abona en **10 cuotas anuales** (junio a marzo), descansando esos 2 meses.

### RN-04: Alerta de Aumento Excesivo en Tabla
Además de la anomalía estadística, se muestra un badge de alerta naranja `⚠️ Aumento >25%` si:
- El gasto es de tipo "Fijo" o pertenece a "Servicios Públicos", "Contratos y Abonos", o "Varios"
- El aumento respecto al mismo concepto en el mes anterior supera **25%**

### RN-05: Auditoría de Proveedores vs. IPC
Compara el gasto de **7 proveedores fijos** entre el mes seleccionado y el **mismo mes del año anterior**:

| Semáforo | Condición |
|---|---|
| 🟢 Estable | Variación ≤ IPC + 5% |
| 🟡 Alto | IPC + 5% < Variación ≤ IPC + 25% |
| 🔴 Excesivo | Variación > IPC + 25% |

También calcula el **desvío en pesos** (diferencia entre el monto pagado y el monto "justo" inflacionado por IPC).

### RN-06: Monitoreo de Servicios Públicos
El sistema verifica la presencia del término **"Lomas de Zamora"** en las páginas web de cortes programados de Edesur (ENRE), AySA y Metrogas. Si aparece, emite una alerta.

Si el sitio no responde, el estado se reporta como **"Desconocido"** (no como Normal), evitando falsos positivos.

### RN-07: Proyección de IPC
Si el índice de INDEC no tiene datos hasta el mes actual (hay lag de publicación), el sistema proyecta automáticamente los meses faltantes usando una **tasa promedio fija de 4.2% mensual** hasta Julio 2026.

**🔍 Inferido** — Este valor hardcodeado sugiere que fue calibrado en un período donde la inflación estaba convergiendo a ~50% anual ≈ 4.2% mensual.

### RN-08: Emparejamiento Inteligente de Conceptos
Para calcular variaciones mes a mes, el sistema identifica si dos conceptos en meses distintos corresponden al mismo ítem usando:
1. **Cuenta AySA**: Si ambos tienen código `1411XX` diferente → no son el mismo
2. **Cliente Edesur**: Si ambos tienen código `8050XX` diferente → no son el mismo
3. **Prefijo**: Comparación de los primeros 30 caracteres del concepto en minúsculas

### RN-09: Descarga Predictiva de PDFs
El script predice el nombre del PDF a descargar usando el patrón:
```
{consorcio}_{edificio}_{periodo}_{documento}
326_151_YYYY-MM_liquidacion.pdf
```
Codificado en Base64, se consulta la API del portal de administración:
```
https://web.administracionglobal.com/api/Descargas/?i={payload_b64}&m={email_b64}
```
Se usa un email dummy en Base64 ya que la API lo requiere como parámetro obligatorio del query string, pero **no realiza autenticación ni validación** del mismo.

> **✅ Confirmado por historial del chat** — Inicialmente se usó el email real del copropietario (`alexis.martyniuk@gmail.com`) como parámetro `m=`. Durante el desarrollo se descubrió que la API acepta cualquier valor en ese campo sin verificarlo, por lo que se reemplazó por un email dummy para evitar exponer datos personales en el código fuente:
> ```python
> # Versión original (descartada):
> EMAIL_B64 = base64.b64encode(b"alexis.martyniuk@gmail.com").decode('utf-8')
>
> # Versión actual:
> DUMMY_EMAIL_B64 = base64.b64encode(b"dummy@administracionglobal.com").decode('utf-8')
> ```
> Esto implica que el endpoint de descarga es **públicamente accesible** para cualquier persona que conozca el patrón de payload (`{consorcio}_{edificio}_{periodo}_{documento}` en Base64). La "seguridad" del portal descansa únicamente en la oscuridad del patrón de nombre, no en autenticación real.

> **✅ Confirmado por historial del chat** — Un comentario presente en una versión anterior de `download_historico.py` (eliminado en una refactorización posterior) decía explícitamente:
> ```python
> # Si no existe (normalmente da error 404 o 500 si no hay archivo en Azure)
> ```
> Esto confirma que el backend de `web.administracionglobal.com` usa **Microsoft Azure** como infraestructura de almacenamiento para los PDFs. La mención a **Microsoft Fabric** (que incluye Azure Blob Storage como componente de almacenamiento) es consistente con este hallazgo, aunque el historial solo especifica "Azure" sin detallar el servicio exacto (Blob Storage, Data Lake, Fabric Files, etc.). La ingesta del sistema funciona de forma transparente a esto, ya que consume la URL pública de la API sin interactuar directamente con Azure.

### RN-10: Control de Duplicados en Descarga
Antes de hacer cualquier request HTTP, el script verifica si el archivo ya existe en disco. Si existe, lo omite completamente (sin consumir red ni API).

---

## 7. Arquitectura General

**✅ Confirmado**

```
┌──────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA SERVERLESS ESTÁTICA              │
│                                                                  │
│  Desarrollador/Copropietario                                     │
│  ┌───────────────────────────────┐                               │
│  │  Repositorio GitHub (main)    │                               │
│  │  ├── index.html               │                               │
│  │  ├── dashboard.js             │                               │
│  │  ├── unidades.html/js         │                               │
│  │  ├── gastos.json  ←──────┐    │                               │
│  │  ├── prorrateo.json ◄────┤    │                               │
│  │  └── servicios_status.json◄── │ GitHub Actions (cron)        │
│  └───────────────────────────────┘                               │
│            │ auto-deploy on push                                 │
│            ▼                                                      │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐  │
│  │ Vercel CDN (estático│   │ GitHub Actions Workers            │  │
│  │ /sarmiento-360)     │   │ ubuntu-latest                     │  │
│  └─────────────────────┘   │ - Python 3.10                     │  │
│            │               │ - pdfplumber                      │  │
│            ▼               │ - requests                        │  │
│  Browser del Copropietario │ - download_historico.py           │  │
│  ├── fetch gastos.json      │ - extract_data.py                 │  │
│  ├── fetch prorrateo.json   │ - extract_prorrateo.py           │  │
│  └── fetch APIs externas   │ - check_servicios.py              │  │
│      ├── INDEC IPC API      │ - cron_update.py (coordinador)   │  │
│      └── servicios_status  └──────────────────────────────────┘  │
│           .json                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Costo de infraestructura: $0** (GitHub Actions free tier + Vercel free tier)

---

## 8. Tecnologías Utilizadas

**✅ Confirmado**

### Frontend
| Tecnología | Versión | Uso |
|---|---|---|
| HTML5 | — | Estructura semántica |
| Vanilla CSS | — | Diseño con variables CSS, dark mode, glassmorphism |
| Vanilla JavaScript ES6+ | — | Lógica del dashboard |
| ApexCharts | CDN (latest) | Gráficos interactivos |
| Google Fonts (Outfit, Inter) | CDN | Tipografía |
| Vercel Web Analytics | CDN | Contador de visitas y analítica |

### Backend de Ingesta (Python)
| Tecnología | Uso |
|---|---|
| Python 3.10 | Runtime |
| `pdfplumber` | Extracción de texto desde PDFs |
| `requests` | Descarga de PDFs desde API de administración |
| `urllib.request` | Scraping de páginas de servicios públicos |
| `re` (regex) | Parseo de líneas de liquidaciones |
| `json` | Serialización de datos |
| `concurrent.futures.ThreadPoolExecutor` | Descarga paralela de PDFs (20 hilos) |
| `ssl` | Compatibilidad SSL multiplataforma (Windows/Linux) |

### CI/CD e Infraestructura
| Tecnología | Uso |
|---|---|
| GitHub Actions | Orquestación de cron jobs y despliegue |
| Vercel | Hosting estático y CDN |
| Git | Control de versiones y persistencia de datos (JSON como base de datos) |

### APIs Externas
| API | Uso |
|---|---|
| `https://apis.datos.gob.ar/series/api/` | IPC mensual oficial INDEC (Argentina) |
| `https://web.administracionglobal.com/api/Descargas/` | Descarga de PDF de liquidaciones |
| `https://www.enre.gov.ar/web/cortes/cortes-edesur.html` | Estado de cortes Edesur |
| `https://www.aysa.com.ar/usuarios/cortes-de-agua` | Estado de cortes AySA |
| `https://www.metrogas.com.ar/cortes` | Estado de cortes Metrogas |

---

## 9. Estructura del Proyecto

**✅ Confirmado**

```
Administracion_Sarmiento360/
│
├── .github/
│   └── workflows/
│       └── deploy.yml              # Pipeline CI/CD (cron + despliegue)
│
├── liquidaciones/                  # PDFs de liquidaciones descargados
│   └── 326_151_YYYY-MM_liquidacion.pdf
│
├── FC Adm/                         # 🔍 Inferido: Facturas de administración escaneadas (uso local)
│
│   ── SCRIPTS PYTHON (Backend de Ingesta) ──
├── cron_update.py                  # Coordinador maestro de cron jobs
├── download_historico.py           # Descarga predictiva de PDFs
├── extract_data.py                 # Parser de gastos desde PDFs → gastos.json
├── extract_prorrateo.py            # Parser de prorrateo por U.F. → prorrateo.json
├── check_servicios.py              # Monitor de servicios públicos → servicios_status.json
│
│   ── DATOS (Base de datos en JSON) ──
├── gastos.json                     # BD de gastos, balances y multas (~546 KB)
├── prorrateo.json                  # BD de expensas por U.F. (~4.4 MB)
├── servicios_status.json           # Estado actual de Edesur/AySA/Metrogas
│
│   ── FRONTEND ──
├── index.html                      # Página principal: Dashboard de gastos
├── dashboard.js                    # Lógica completa del dashboard (1.451 líneas)
├── unidades.html                   # Página: Dashboard por U.F.
├── unidades.js                     # Lógica del dashboard de U.F.
│
│   ── MATERIALES IMPRESOS ──
├── cartelera_dashboard.html        # Flyer A4 para cartelera del edificio
├── cartelera_dashboard.pdf         # PDF compilado (1 página A4)
├── cartelera_dashboard_media_hoja.html  # Flyer doble (2×A5) con línea de corte
├── cartelera_dashboard_media_hoja.pdf   # PDF compilado (2 flyers en 1 A4)
│
│   ── SEO Y CONFIGURACIÓN ──
├── robots.txt                      # Directivas para buscadores
├── sitemap.xml                     # Mapa del sitio
├── vercel.json                     # Configuración de Vercel
├── .gitignore
├── LICENSE (MIT)
└── README.md
```

---

## 10. Modelo de Datos

**✅ Confirmado**

### `gastos.json`
```json
{
  "gastos": [
    {
      "periodo": "YYYY-MM",
      "rubro": "Sueldos y Cargas Sociales",
      "concepto": "Texto del concepto extraído del PDF",
      "monto": 150000.00,
      "tipo": "Fijo|Variable",
      "servicio": "AySA|Edesur|Metrogas|null",
      "empleado": "Encargado Permanente|Ayudante / Suplente|Cargas Sociales / Sindicato|Yamil Reparaciones|null",
      "estado": "Pagado|Pendiente",
      "anomalia": false,
      "desviacion_pct": 0
    }
  ],
  "balances": [
    {
      "periodo": "YYYY-MM",
      "ingresos": 0.0,
      "egresos": 0.0,
      "saldo_banco": 0.0,
      "recaudado_termino": 0.0,
      "deuda_acumulada": 0.0,
      "patrimonio_neto": 0.0,
      "saldo_disponibilidades": 0.0
    }
  ],
  "multas": [
    {
      "periodo": "YYYY-MM",
      "uf": "001",
      "propietario": "Nombre del Propietario",
      "motivo": "Por descripción de la infracción",
      "monto": 5000.0
    }
  ]
}
```

### `prorrateo.json`
```json
{
  "prorrateo": [
    {
      "uf": 1,
      "dpto": "1 A",
      "propietario": "APELLIDO NOMBRE",
      "saldo_anterior": 0.0,
      "pagos": 0.0,
      "deuda": 0.0,
      "interes": 0.0,
      "ga_pct": 0.000,
      "ga_monto": 0.0,
      "gb_pct": 0.000,
      "gb_monto": 0.0,
      "multa": 0.0,
      "gastos_extra": 0.0,
      "fondo_operativo_pct": 0.000,
      "fondo_operativo_monto": 0.0,
      "red_ajustes": 0.0,
      "total": 0.0,
      "periodo": "YYYY-MM"
    }
  ]
}
```

### `servicios_status.json`
```json
{
  "actualizado": "DD/MM/YYYY HH:MM",
  "edesur": { "status": "Normal|Alerta|Desconocido", "message": "..." },
  "aysa":   { "status": "Normal|Alerta|Desconocido", "message": "..." },
  "metrogas": { "status": "Normal|Alerta|Desconocido", "message": "..." }
}
```

---

## 11. Relaciones entre Entidades

**✅ Confirmado / 🔍 Inferido**

```
Período (YYYY-MM)
  │
  ├──< Gastos (N por período)
  │     ├── rubro (FK lógica a CAT_CONFIG)
  │     ├── servicio (FK lógica a [AySA, Edesur, Metrogas])
  │     └── empleado (FK lógica a [Encargado, Ayudante, Cargas, Yamil])
  │
  ├── Balance (1 por período)
  │     ├── ingresos
  │     ├── egresos
  │     ├── patrimonio_neto
  │     └── saldo_disponibilidades
  │
  ├──< Multas (N por período)
  │     └── uf (FK a Unidad Funcional)
  │
  └──< Prorrateo (N por período, 1 por U.F.)
        └── uf (PK compuesta: periodo + uf)

IPC-INDEC (indexado por período YYYY-MM)
  └── Se usa como referencia externa para auditorías y anomalías
      (no se persiste en disco, se carga en runtime)
```

---

## 12. Flujo de Procesamiento de PDFs

**✅ Confirmado**

```
PDF de Liquidación (326_151_YYYY-MM_liquidacion.pdf)
│
├── 1. Identificación del Período
│   └── Regex sobre el nombre del archivo: (\d{4})-(\d{2})
│
├── 2. Extracción Página por Página
│   └── pdfplumber → texto plano por página
│       ├── Se detectan "RUBROS" (encabezados de categoría con regex)
│       ├── Se detecta sección "PAGOS DEL PERÍODO" vs "GASTOS DEVENGADOS PENDIENTES"
│       └── Se detecta bloque "Detalle de Multas"
│
├── 3. Extracción de Gastos (parse_pdf_expenses)
│   ├── Para cada línea dentro de un RUBRO activo:
│   │   ├── Regex principal: `^(.*?)\s+((?:-?\d+(?:\.\d{3})*,\d{2}\s+)*-?\d+(?:\.\d{3})*,\d{2})$`
│   │   ├── Se extrae: concepto (parte izquierda) + montos (parte derecha)
│   │   ├── Se toma el último monto como el "total" de esa línea
│   │   ├── Si la siguiente línea NO tiene monto propio → se concatena al concepto actual
│   │   ├── Filtros de exclusión: conceptos < 4 chars, monto ≤ 0, palabras clave de resúmenes
│   │   └── Normalización del monto: "1.234,56" → 1234.56
│   └── Para cada línea de MULTAS:
│       └── Regex: `^(\d+)\s+(.+?)\s+(\d+)\s*$` → uf, propietario/motivo, monto
│
├── 4. Extracción del Balance Mensual
│   └── Regex específicos sobre líneas de "Ingresos", "Egresos", "SALDO FINAL",
│       "PATRIMONIO NETO", "SALDO DE DISPONIBILIDADES"
│
├── 5. Extracción del Prorrateo por U.F. (extract_prorrateo.py)
│   ├── Solo se procesan páginas que contienen "ESTADO DE CUENTAS" o "PRORRATEO"
│   └── Cada línea de U.F. sigue el patrón:
│       `UF DPTO PROPIETARIO N1 N2 N3 N4 N5 N6 N7 N8 N9 N10 N11 N12 N13 N14`
│       (14 columnas numéricas fijas al final, UF de 3 dígitos al inicio y al final)
│
├── 6. Detección de Anomalías (detect_anomalies)
│   ├── Se normaliza el concepto (sin fechas, sin meses) para buscar historial
│   ├── Si hay ≥ 2 instancias históricas del concepto:
│   │   └── Si monto_actual > promedio_histórico × 1.45 → anomalia = True
│   └── Se adjunta desviacion_pct al registro
│
└── 7. Persistencia
    ├── gastos.json  → { gastos[], balances[], multas[] }
    └── prorrateo.json → { prorrateo[] }
```

---

## 13. Estrategia de Extracción de Información

**✅ Confirmado**

- **Tecnología**: `pdfplumber` (extracción de texto via PDFMiner)
- **Estrategia**: Extracción de texto plano → parseo línea a línea con regex
- **Sin OCR**: Los PDFs son digitales (no escaneados), por lo que no se requiere OCR
- **Sin IA/ML**: La clasificación es completamente basada en reglas (keyword matching)
- **Manejo de multi-línea**: Si una línea no termina en número, se asume que es continuación del concepto de la línea anterior y se concatena

### Potenciales limitaciones conocidas
- Si la administración cambia el formato de PDF, el parser fallará silenciosamente en esos registros
- La detección de rubro por nombre de sección puede fallar si aparecen acentos con codificación diferente (el código maneja múltiples variantes de "trmino", "término", "tãrmino")
- `pdfplumber` puede duplicar texto de elementos flotantes; se dedupean las multas por key compuesta

---

## 14. Pipeline de Procesamiento de Datos

**✅ Confirmado**

```
GitHub Actions Scheduler
│
├── [DIARIO 4×] cron: 0 0,9,15,21 * * *
│   └── cron_update.py --services-only
│       └── check_servicios.py → servicios_status.json
│
└── [MENSUAL días 1-5] cron: 0 21 1-5 * *
    └── cron_update.py --all
        ├── check_servicios.py → servicios_status.json
        └── Si período esperado NO está en gastos.json:
            ├── download_historico.py
            │   ├── ThreadPoolExecutor(max_workers=20)
            │   ├── Prueba URL predictiva → si devuelve PDF válido → guarda
            │   └── Busca desde 2020 hasta mes actual (years × months × doc_patterns)
            ├── extract_data.py → gastos.json
            └── extract_prorrateo.py → prorrateo.json

En todos los casos:
└── git add gastos.json prorrateo.json servicios_status.json liquidaciones/
    └── Si hay cambios → git commit + git pull --rebase + git push
        └── Vercel auto-deploys desde main
```

---

## 15. Dashboards Disponibles

**✅ Confirmado**

### Dashboard Principal (`index.html` + `dashboard.js`)

Secciones:
1. **Sidebar de navegación**: Links, filtros rápidos, widget de servicios, alertas de facturas faltantes
2. **KPIs resumen**: Recaudado, Egresado, Balance, Gastos Pendientes
3. **Alerta de Anomalías**: Sección colapsable que aparece solo cuando hay anomalías
4. **Gráfico Histórico de Líneas**: Evolución mensual por categoría con zoom
5. **Gráfico Donut**: Distribución porcentual de gastos del período
6. **Gráfico de Barras Apiladas (Comparativo)**: Total mensual por categoría
7. **Gráficos de Drilldown** (7 gráficos, uno por categoría): Evolución de subcategorías
8. **Sección de Empleados**: KPIs + gráfico de barras de sueldos por empleado
9. **Tabla de Gastos**: Paginada, ordenable, con filtros y exportación
10. **Tabla de Multas**: Por U.F., filtrable por período
11. **Auditoría de Proveedores**: Comparación YoY vs. IPC
12. **Gráfico Patrimonial**: Patrimonio Neto y Disponibilidades Líquidas en el tiempo
13. **Modal de Proveedor**: Al clicar un concepto, muestra todo su historial

### Dashboard de Unidades Funcionales (`unidades.html` + `unidades.js`)

Secciones:
1. **Widget de servicios públicos** (igual al principal)
2. **Tabla de prorrateo por U.F.**: Todas las columnas del estado de cuenta por unidad
3. **Filtro por período y búsqueda por propietario/dpto**
4. **Exportación CSV y PDF**

---

## 16. KPIs Calculados

**✅ Confirmado**

| KPI | Fuente | Descripción |
|---|---|---|
| Recaudado | `balances[].ingresos` | Total de ingresos del período |
| Egresado | `balances[].egresos` | Total de egresos del período |
| Balance Neto | Recaudado - Egresado | Si > 0: cubre gastos; si < 0: déficit |
| Gastos Pendientes | `gastos[].estado = "Pendiente"` | Deuda flotante (devengado no pagado) |
| Δ vs. mes anterior (Recaudado) | % | Variación respecto al período anterior |
| Δ vs. mes anterior (Egresado) | % | Variación respecto al período anterior |
| Patrimonio Neto | `balances[].patrimonio_neto` | Del estado patrimonial del PDF |
| Disponibilidades Líquidas | `balances[].saldo_disponibilidades` | Saldo en caja/banco al cierre |

---

## 17. Métricas Derivadas

**✅ Confirmado**

| Métrica | Cálculo |
|---|---|
| Variación % por concepto | `(monto_actual - monto_prev) / monto_prev × 100` |
| Inflación IPC acumulada YoY | `(IPC_actual - IPC_prev_año) / IPC_prev_año × 100` |
| Desvío en $ vs. inflación | `monto_actual - (monto_prev_año × (1 + IPC_acum))` |
| Promedio mensual histórico | Suma histórica / cantidad de meses |
| Acumulado histórico por empleado | Suma de todos los meses de ese empleado |
| Porcentaje de categoría | Gasto categoría / gasto total período × 100 |
| Anomalía estadística | Desviación en % sobre promedio móvil últimas 3 instancias |

---

## 18. Comparaciones entre Meses

**✅ Confirmado**

- **En KPIs**: Δ% vs. el período inmediatamente anterior
- **En tabla**: Cada fila muestra el monto del mes anterior del mismo concepto y el Δ%
- **En gráficos históricos**: Tooltip muestra Δ% vs. mes anterior + inflación IPC de ese mes
- **En auditoría de proveedores**: Comparación vs. **mismo mes del año anterior** (YoY)

---

## 19. Comparaciones entre Edificios

**❓ Indeterminado** — El sistema está hardcodeado para el consorcio `326`, edificio `151`. No existe infraestructura para comparar con otros edificios. El código no tiene preparación arquitectónica para multi-edificio.

---

## 20. Algoritmos, Cálculos y Transformaciones

**✅ Confirmado**

### Normalización de montos (Python)
```python
val_str.replace(" ", "").replace(".", "").replace(",", ".")
# "1.234.567,89" → "1234567.89"
```

### Promedio móvil de anomalías (JavaScript)
```javascript
const recent = prev.slice(-3); // Últimas 3 ocurrencias
const avg = recent.reduce((a, v) => a + v, 0) / recent.length;
if (avg > 10000 && monto > avg * 1.45 && !isSAC) → anomalia = true
```

### Proyección de IPC (JavaScript)
```javascript
const projectedInf = 4.2; // % mensual proyectado
lastVal = lastVal * (1 + projectedInf / 100);
```

### Clasificación de subcategorías
Función `getSubcategoria(expense)` — 40+ reglas de keyword matching para desagregar cada categoría en subcategorías para los gráficos de drilldown.

### Descarga predictiva concurrente (Python)
```python
with ThreadPoolExecutor(max_workers=20) as executor:
    results = executor.map(try_download, payloads_to_check)
```
Prueba todas las combinaciones de años × meses × tipos de documento en paralelo.

---

## 21. Supuestos del Sistema

**🔍 Inferidos** salvo donde se indica.

| ID | Supuesto |
|---|---|
| S-01 | Los PDFs de liquidación son digitales (no escaneados). Sin OCR. **✅ Confirmado** |
| S-02 | La administración usa el portal `web.administracionglobal.com`. **✅ Confirmado** |
| S-03 | El nombre del PDF sigue el patrón `326_151_YYYY-MM_liquidacion.pdf`. **✅ Confirmado** |
| S-04 | La liquidación del mes N se publica en los primeros días de mes N+1. **✅ Confirmado** |
| S-05 | El seguro de consorcio descansa en abril y mayo (10 cuotas: jun–mar). **✅ Confirmado** |
| S-06 | Un aumento >45% respecto al promedio histórico es estadísticamente anómalo. **✅ Confirmado** |
| S-07 | La inflación futura puede aproximarse con 4.2% mensual cuando no hay datos. **🔍 Inferido** |
| S-08 | "Lomas de Zamora" en la página de cortes implica afectación al edificio. **🔍 Inferido** |
| S-09 | Los datos del mes más reciente pueden estar incompletos (se excluye de la auditoría de faltantes). **✅ Confirmado** |
| S-10 | Un SAC/Aguinaldo no es anomalía aunque sea el doble del sueldo mensual. **✅ Confirmado** |
| S-11 | Los primeros 30 caracteres del concepto (en minúsculas) identifican unívocamente al proveedor, salvo para AySA y Edesur que requieren comparar el número de cuenta. **✅ Confirmado** |

---

## 22. Configuraciones y Variables Importantes

**✅ Confirmado**

### Python (Backend)
| Variable | Valor | Descripción |
|---|---|---|
| `LIQUIDACIONES_DIR` | `"liquidaciones"` | Directorio local de PDFs |
| `OUTPUT_JSON` (extract_data) | `"gastos.json"` | Archivo de salida de gastos |
| `OUTPUT_JSON` (extract_prorrateo) | `"prorrateo.json"` | Archivo de salida de prorrateo |
| `OUTPUT_PATH` (check_servicios) | `"servicios_status.json"` | Archivo de salida de estado |
| `CONSORCIO` | `"326"` | ID del consorcio en el portal |
| `EDIFICIO` | `"151"` | ID del edificio en el portal |
| `DUMMY_EMAIL_B64` | Email dummy en Base64 | Requerido por la API (no autentica) |
| `max_workers` | `20` | Hilos de descarga paralela |
| Años de búsqueda | `2020` a año actual | Rango histórico de búsqueda |
| Timeout HTTP | `10` seg (descarga) / `8` seg (servicios) | Límite de tiempo por request |
| Umbral de anomalía | `1.45×` promedio | Factor de desviación |
| Mínimo para anomalía | `$10.000 ARS` | Filtro de ruido mínimo |

### JavaScript (Frontend)
| Variable | Valor | Descripción |
|---|---|---|
| `pageSize` | `20` | Registros por página (default) |
| Tasa IPC proyectada | `4.2%` | Mensual, cuando no hay datos INDEC |
| Límite de proyección | `2026-07` | Mes hasta el que se proyecta IPC |
| Ventana gráficos | `últimos 12 meses` | Zoom inicial de todos los gráficos |
| Umbral alerta aumento | `25%` | Para badge naranja en tabla |
| Umbral auditoría "Alto" | `IPC + 5%` | Para semáforo amarillo |
| Umbral auditoría "Excesivo" | `IPC + 25%` | Para semáforo rojo |
| Tolerancia desvío $ | `$50 ARS` | Diferencias menores a esto se muestran como $0 |

### GitHub Actions (CI/CD)
| Configuración | Valor |
|---|---|
| Runner | `ubuntu-latest` |
| Python version | `3.10` |
| Cron servicios | `0 0,9,15,21 * * *` (UTC) |
| Cron expensas | `0 21 1-5 * *` (UTC) |
| Permisos | `contents: write` |
| Fetch depth | `0` (historial completo para commits) |

---

## 23. Dependencias Externas

**✅ Confirmado**

| Dependencia | Tipo | Impacto si falla |
|---|---|---|
| `web.administracionglobal.com` (frontend API) | Crítica | Sin nuevas liquidaciones automáticas |
| **Microsoft Azure** (backend del portal, ✅ confirmado) | Crítica | Si Azure cae, el portal no sirve los PDFs aunque la URL sea accesible |
| `apis.datos.gob.ar` (INDEC) | Alta | IPC se reemplaza por proyección (4.2%) |
| `enre.gov.ar` / `edesur.com.ar` | Media | Estado Edesur queda "Desconocido" |
| `aysa.com.ar` | Media | Estado AySA queda "Desconocido" |
| `metrogas.com.ar` | Media | Estado Metrogas queda "Desconocido" |
| GitHub Actions | Crítica | Sin automatización de ingestas ni actualizaciones |
| Vercel | Crítica | Sin hosting del dashboard |
| ApexCharts (CDN) | Alta | Sin gráficos (datos siguen accesibles en tabla) |
| Google Fonts (CDN) | Baja | Degradación de tipografía (fallback a sans-serif) |
| Vercel Web Analytics | Mínima | Sin métricas de visitas |

---

## 24. Estrategia de Almacenamiento

**✅ Confirmado**

- **No hay base de datos**: Se usan archivos JSON estáticos como base de datos
- **Persistencia via Git**: Los JSON se commitean al repositorio en cada actualización
- **Git como historial**: Cada commit mantiene el historial de versiones de los datos
- **Tamaños actuales**:
  - `gastos.json`: ~547 KB
  - `prorrateo.json`: ~4.4 MB (el más grande, crece linealmente con meses × UFs)
  - `servicios_status.json`: ~474 bytes (siempre pequeño)

**🔍 Inferido** — La escalabilidad del almacenamiento es limitada. A largo plazo (5-10 años), `prorrateo.json` podría superar los 20-30 MB, lo que impactaría los tiempos de carga del dashboard de U.F.

---

## 25. Rendimiento

**✅ Confirmado / 🔍 Inferido**

| Aspecto | Valor / Estrategia |
|---|---|
| Tiempo de carga inicial | ~1-3 seg (fetch de JSON de ~5MB total) |
| Recálculo de filtros | Síncrono en memoria (sin requests adicionales) |
| Descarga de PDFs | 20 hilos en paralelo |
| Optimización de descarga | Verificación previa de existencia en disco (sin request) |
| Validación temprana de PDF | Lee solo el primer KB para verificar magic bytes `%PDF` |
| Renderizado de gráficos | ApexCharts con destroy/re-render en cada filtro |
| CDN de hosting | Vercel Edge Network (global) |

**🔍 Inferido** — El mayor cuello de botella de rendimiento es el tamaño de `prorrateo.json` (~4.4 MB), especialmente en redes lentas o dispositivos móviles.

---

## 26. Seguridad

**✅ Confirmado / 🔍 Inferido**

| Aspecto | Estado |
|---|---|
| Autenticación de usuarios | ❌ No existe (público sin restricciones) |
| Autorización | ❌ No existe |
| Datos sensibles | ⚠️ Los PDFs y JSON contienen nombres reales de propietarios y empleados del consorcio |
| HTTPS | ✅ Enforced por Vercel |
| API de descarga | ⚠️ Usa email dummy en Base64 (no credenciales reales) |
| SSL en scraping | ✅ Dual strategy para Windows y Linux |
| Secretos en CI/CD | ❓ No se detectan secrets de GitHub Actions en uso activo |
| Sanitización de input | ✅ Los conceptos se escapan antes de inyectar en HTML (`replace(/'/g, "\\'")`) |

**🔍 Inferido** — Al ser un sitio público sin autenticación, cualquier persona con el link puede acceder a los datos, incluyendo deudas de propietarios y nombres de empleados. Esto puede ser intencional (transparencia del consorcio) o una limitación conocida.

---

## 27. Escalabilidad

**✅ Confirmado / 🔍 Inferido**

| Dimensión | Situación Actual | Limitación |
|---|---|---|
| Usuarios concurrentes | Sin límite (estático CDN) | Ninguna |
| Volumen de datos | ~5MB total | prorrateo.json crecerá linealmente |
| Períodos históricos | Desde 2020 | Sin límite técnico |
| Edificios | 1 (hardcodeado) | Requeriría refactoring significativo |
| Proveedores auditados | 7 (hardcodeados) | Fácil de ampliar |
| Categorías de gastos | 7 (fijas, del PDF) | Depende del formato de liquidación |

---

## 28. Posibles Limitaciones

**🔍 Inferido**

1. **Cambio de formato del PDF**: Si la administración modifica el formato, el parser fallará. No hay alertas de fallo de parseo hacia el usuario final.
2. **Multi-edificio**: Arquitectura no preparada para gestionar múltiples consorcios.
3. **Visibilidad pública**: Datos personales (propietarios, empleados) son accesibles públicamente.
4. **IPC proyectado**: Si la inflación real difiere significativamente del 4.2% proyectado, las auditorías de proveedores de meses recientes serán inexactas.
5. **Dependencia del portal externo**: Si `web.administracionglobal.com` cambia su API o requiere autenticación real, la ingesta automática dejará de funcionar.
6. **Memoria del browser**: Con años de datos, el JSON de prorrateo (~4.4MB) podría afectar dispositivos de bajas prestaciones.
7. **Rate limiting en scraping**: Los sitios de servicios pueden bloquear el User-Agent o la IP de GitHub Actions.
8. **Sin tests automatizados**: No hay tests unitarios ni de integración detectados.
9. **Sin staging environment**: Los cambios van directamente a producción.

---

## 29. Funcionalidades Pendientes o Implícitas

**🔍 Inferido**

1. **Respuesta formal de administración**: Existe `respuesta_administracion.txt` en el repositorio, sugiriendo que el dashboard también sirve como evidencia de reclamos formales documentados.
2. **Gráfico de morosidad**: El comentario `// ── MOROSITY CHART ───────────────────────────────────────────────` en `dashboard.js` (línea 862) está vacío, sugiriendo un gráfico planificado para mostrar morosidad de U.F. que no se implementó.
3. **Sub-página de avisos**: El descargador busca documentos tipo `avisos_0151-0026` y `avisos_0151-0168` (probablemente avisos individuales para U.F. 26 y 168), sugiriendo que podría agregarse una sección de avisos al dashboard.
4. **Sub-página de recibos individuales**: Igual, descarga `recibos_unidad_0151-XXXX`, los recibos individuales de cada unidad.
5. **Auditoría de madurez de deudas**: Los campos `saldo_anterior`, `deuda`, `interes` del prorrateo permitirían construir un módulo de análisis de morosidad por U.F.
6. **Notificaciones automáticas**: El sistema genera alertas visuales pero no envía notificaciones (email/WhatsApp) automáticas.

---

## 30. Decisiones de UX/UI

**✅ Confirmado / 🔍 Inferido**

| Decisión | Razonamiento inferido |
|---|---|
| Dark mode único | Preferencia estética del desarrollador; más fácil de leer datos financieros |
| Glassmorphism + blur | Diseño moderno premium, diferencia el proyecto de un reporte genérico |
| Sidebar fija (sticky) | El usuario navega datos largos, necesita acceso constante a los filtros |
| Gráficos zoomados por defecto a últimos 12 meses | Los datos históricos desde 2020 hacen los gráficos ilegibles sin zoom inicial |
| Tooltips personalizados en CSS | ApexCharts no ofrece tooltips fuera del área del gráfico; se usan para headers y elementos de la sidebar |
| Tooltips `data-tooltip-top-right` en sidebar | La sidebar tiene `overflow-y: auto`, que corta los tooltips que van hacia arriba o a los lados. Van hacia arriba-izquierda para mantenerse dentro |
| Paginación con 20 registros default | Balance entre performance y usabilidad |
| Modal de proveedor al clicar concepto | Permite ver el historial de un proveedor sin salir de la tabla principal |
| Flyers imprimibles para cartelera | Mecanismo offline para comunicar la existencia del dashboard a los vecinos que no lo conocen |
| SEO (robots.txt + sitemap.xml) | El desarrollador quiere que el dashboard sea indexable por Google para demostrar transparencia pública |
| Categorías con emoji + color | Identificación visual rápida, reduce la necesidad de leer el texto de la categoría |
| Badge "Fijo/Variable" | Ayuda al usuario a entender qué gastos son estructurales vs. contingentes |
| Alertas de facturas faltantes en sidebar | Visibilidad inmediata de irregularidades al cargar la página |
| Widget de servicios con timestamp y tooltip | Transparencia sobre cuándo fue la última verificación y cuándo se hará la siguiente |

---

## Resumen Ejecutivo

El proyecto **Sarmiento 360** es un **sistema de auditoría financiera ciudadana** desarrollado por un copropietario para transparentar la gestión del consorcio de un edificio residencial en Argentina.

Implementa un pipeline completamente automatizado y de **costo cero** que:
1. **Descarga** automáticamente las liquidaciones PDF de expensas del portal de la administración
2. **Parsea** el contenido con regex y keyword-matching (sin IA/ML)
3. **Almacena** los datos estructurados en JSON versionados en Git
4. **Visualiza** los datos en un dashboard web estático moderno con análisis inflacionario, detección de anomalías y auditoría de proveedores
5. **Monitorea** en tiempo real el estado de los servicios públicos esenciales del edificio

La arquitectura prioriza la **independencia total** (no depende de la administración para acceder a los datos una vez descargados), el **costo cero** (GitHub + Vercel tier gratuito) y la **transparencia** (sitio públicamente accesible sin login).
