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
  * **check_servicios.py:** Script de Python encargado de auditar la red de servicios locales (Luz con Edesur, Agua con AySA y Gas con Metrogas) para alertar interrupciones activas en la zona.

---

## 📁 Estructura del Proyecto
```
Administracion_Sarmiento360/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Pipeline de CI/CD para GitHub Pages
├── Landing/                    # Documentación original, liquidaciones y recibos
├── liquidaciones/              # Archivos PDF estandarizados de liquidación
├── check_servicios.py          # Script de monitoreo de Luz, Agua y Gas
├── extract_data.py             # Parser principal de datos de expensas y balances
├── extract_prorrateo.py        # Parser de expensas por U.F. (70 U.F.s)
├── gastos.json                 # Base de datos consolidada de gastos
├── prorrateo.json              # Base de datos consolidada de U.F. e intereses
├── index.html                  # Panel de Control General de Gastos
├── dashboard.js                # Lógica del dashboard de gastos
├── unidades.html               # Panel de control de Unidades Funcionales
├── unidades.js                 # Lógica de deudas e intereses por U.F.
├── robots.txt                  # Directivas de buscadores para SEO
├── sitemap.xml                 # Mapa del sitio para buscadores
├── LICENSE                     # Licencia del proyecto (MIT)
└── README.md                   # Documentación técnica
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
  * **Si no tiene datos:** Ejecuta `download_historico.py` para descargar el nuevo PDF, y luego corre `extract_data.py` y `extract_prorrateo.py` para procesarlo.

### 💾 Persistencia Automática de Cambios
Si tras la ejecución del cron se detecta que cambió el estado de los servicios locales o se integró una nueva expensa:
1. El workflow de GitHub Actions realiza un commit automático de vuelta a la rama `main` para guardar la información histórica en Git.
2. Despliega la versión actualizada del sitio estático en la rama `gh-pages`.
3. Vercel sirve de forma directa el contenido actualizado en la subruta de producción.
