import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import os
import re
import json
import pdfplumber

STEP_DIR = r"C:\Users\Martyniuk-Ntbk-Gmr\.gemini\antigravity\brain\c0211e8c-1c1d-4b0a-af4b-5f5ee25ba132\.system_generated\steps"
CACHE_DIR = "data_consorcioabierto"
LIQUIDACIONES_DIR = "liquidaciones"
GASTOS_JSON = "gastos.json"
PRORRATEO_JSON = "prorrateo.json"

CONSORCIO_ID = 27151
LIQUIDACIONES_CA = {
    "2026-08": 633528,
    "2026-09": 645048,
}


def sync_from_consorcioabierto_api(ca_bundle):
    """
    Se autentica contra https://app.consorcioabierto.com/login y consulta la API REST
    del Consorcio 27151 (/consorcios/27151/gastos y /liquidaciones-expensas/{id}/prorrateo)
    para actualizar o agregar nuevos períodos publicados.
    """
    import requests
    email = os.environ.get("CONSORCIOABIERTO_EMAIL", "")
    password = os.environ.get("CONSORCIOABIERTO_PASSWORD", "")
    if not email or not password:
        # Sin credenciales en variables de entorno; opera utilizando el bundle/caché local
        return ca_bundle

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        r_login_page = session.get("https://app.consorcioabierto.com/login", timeout=15)
        m_csrf = re.search(r'name="_csrf_token"\s+value="([^"]+)"', r_login_page.text)
        csrf_token = m_csrf.group(1) if m_csrf else ""
        session.post(
            "https://app.consorcioabierto.com/login_check",
            data={"_username": email, "_password": password, "_csrf_token": csrf_token},
            timeout=15
        )
        for periodo, liq_id in LIQUIDACIONES_CA.items():
            r_gastos = session.get(
                f"https://app.consorcioabierto.com/consorcios/{CONSORCIO_ID}/gastos?desde={periodo}&hasta={periodo}",
                headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
                timeout=15
            )
            r_prorr = session.get(
                f"https://app.consorcioabierto.com/liquidaciones-expensas/{liq_id}/prorrateo",
                headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
                timeout=15
            )
            if r_gastos.status_code == 200 and r_prorr.status_code == 200:
                g_json = r_gastos.json()
                p_json = r_prorr.json()
                if "data" in g_json and "filas_ufs" in p_json:
                    ca_bundle.setdefault("periodos", {})[periodo] = {
                        "liquidacion_id": liq_id,
                        "gastos": g_json,
                        "prorrateo": p_json
                    }
                    print(f"   [API ConsorcioAbierto] Sincronizado período {periodo} (Liquidación #{liq_id})")
            pdf_dest = os.path.join(LIQUIDACIONES_DIR, f"360_{periodo}_liquidacion.pdf")
            if not os.path.exists(pdf_dest):
                r_pdf = session.get(f"https://app.consorcioabierto.com/liquidaciones/{liq_id}/pdf", timeout=20)
                if r_pdf.status_code == 200 and r_pdf.content.startswith(b"%PDF"):
                    with open(pdf_dest, "wb") as pf:
                        pf.write(r_pdf.content)
                    print(f"   [API ConsorcioAbierto] Descargado PDF oficial -> {pdf_dest}")
    except Exception as e:
        print(f"   [Aviso API ConsorcioAbierto] Usando caché local ({e})")
    return ca_bundle


def load_step_json(step_num):
    path = os.path.join(STEP_DIR, str(step_num), "output.txt")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    idx = text.find("{")
    if idx == -1:
        return None
    end_idx = text.find("\n### Ran Playwright code")
    if end_idx != -1:
        json_str = text[idx:end_idx].strip()
    else:
        json_str = text[idx:].strip()
    return json.loads(json_str)


def format_dpto_360(raw_uf_str):
    s = str(raw_uf_str).strip().upper().replace("º", "°")
    m = re.match(r"^(\d+)\s*°?\s*([A-C])\s*-\s*(3\d\d)$", s)
    if m:
        return f"{m.group(1)}°{m.group(2)} (Torre {m.group(3)})"
    return s


def normalize_dpto_key(raw_uf_str):
    s = str(raw_uf_str).strip().upper().replace("º", "°")
    m = re.search(r"(\d+)\s*°?\s*([A-C])\s*(?:-\s*|\(TORRE\s*)(3\d\d)", s)
    if m:
        return f"{m.group(1)}°{m.group(2)}-{m.group(3)}"
    return re.sub(r"\s+", "", s)


def clean_historical_col(col_str):
    if not col_str:
        return 0.0
    s = str(col_str).strip()
    is_neg = s.startswith("-$") or (s.startswith("-") and "$" in s)
    s_clean = s.replace("$", "").replace(" ", "").strip()
    if s_clean in ("-", "", "--"):
        return 0.0
    if s_clean.startswith("-"):
        is_neg = True
        s_clean = s_clean[1:].strip()
    if "," in s_clean:
        s_clean = s_clean.replace(".", "").replace(",", ".")
    else:
        s_clean = s_clean.replace(".", "")
    try:
        val = float(s_clean)
        return -val if is_neg else val
    except ValueError:
        return 0.0


def map_ca_category(cuenta_nombre, detalle, proveedor_nombre, es_sueldo, tipo_gasto):
    c = (cuenta_nombre or "").upper()
    d = (detalle or "").upper()
    p = (proveedor_nombre or "").upper()
    t = (tipo_gasto or "").upper()

    if es_sueldo or any(k in c for k in ["SUELDO", "CARGAS SOCIALES", "APORTES SINDICALES"]) or any(k in p for k in ["SUTERH", "FATERYH", "ARCA"]):
        return "Sueldos y Cargas Sociales"
    if t == "EXTRAORDINARIO" or "EXTRAORDINARI" in c:
        return "Gastos Extraordinarios"
    if "SEGURO" in c or any(k in p for k in ["HOLANDO", "ALLIANZ"]):
        return "Seguros"
    if "SERVICIOS PÚBLICOS" in c or "SERVICIOS PUBLICOS" in c or any(k in p for k in ["AYSA", "EDESUR", "METROGAS"]):
        return "Servicios Públicos"
    if "ABONO" in c or "INSUMOS" in c or any(k in p for k in ["BASTIDA", "PERSONAL", "FLOW", "CONSORCIO ABIERTO", "IVESS", "GUILLEMI"]):
        return "Contratos y Abonos"
    if any(k in c for k in ["ADMINISTRACIÓN", "ADMINISTRACION", "BANCARIOS", "IMPUESTOS, TASAS"]) or any(k in p for k in ["BANCO GALICIA", "MERCADO PAGO", "FERNÁNDEZ", "FERNANDEZ"]):
        return "Administración"
    if any(k in c for k in ["MANTENIMIENTO", "REPARACIONES", "REPUESTOS", "LIMPIEZA", "COMBUSTIBLE"]):
        return "Mantenimiento y Reparaciones"
    return "Varios"


def map_ca_rubro(cuenta_nombre, es_sueldo, tipo_gasto):
    c = (cuenta_nombre or "").upper()
    if es_sueldo or "SUELDO NETO" in c or "LIQUIDACIÓN FINAL" in c:
        return "REMUNERACIONES DEL PERSONAL"
    if "CARGAS SOCIALES" in c:
        return "CARGAS SOCIALES"
    if "APORTES SINDICALES" in c:
        return "APORTES SINDICALES"
    if "SERVICIOS PÚBLICOS" in c or "SERVICIOS PUBLICOS" in c or "ABONO" in c:
        return "SERVICIOS PÚBLICOS Y ABONOS"
    if "SEGURO" in c:
        return "SEGUROS ORDINARIOS"
    if "BANCARIOS" in c or "IMPUESTOS, TASAS" in c:
        return "GASTOS BANCARIOS"
    if "ADMINISTRACIÓN" in c or "ADMINISTRACION" in c:
        return "GASTOS DE ADMINISTRACION"
    if (tipo_gasto or "").upper() == "EXTRAORDINARIO" or "EXTRAORDINARI" in c:
        return "GASTOS EXTRAORDINARIOS"
    return "MANTENIMIENTO PARTES COMUNES"


def anonymize_employee(proveedor_nombre, detalle):
    p_up = (proveedor_nombre or "").upper()
    d_up = (detalle or "").upper()
    if "BUSTAMANTE, JUAN" in p_up or "BUSTAMANTE JUAN" in p_up:
        return "Encargado Permanente", "[Encargado Principal]"
    if "BUSTAMANTE, VICTOR" in p_up or "BUSTAMANTE VICTOR" in p_up or "JAVIER" in d_up:
        if "EMPLEADO:" in p_up:
            return "Ayudante / Suplente", "[Ayudante]"
    if "RAMÍREZ, GUILLERMO" in p_up or "RAMIREZ, GUILLERMO" in p_up or "RAMIREZ GUILLERMO" in p_up:
        return "Vigilancia Nocturna", "[Vigilancia Nocturna]"
    return None, None


def transform_ca_expense(item):
    attrs = item.get("attributes", {})
    particular = attrs.get("particular", False)
    importe = float(attrs.get("importe") or 0.0)
    # Exclude unit-specific charge + its negative ordinary adjustment so consortium sum equals exact meta.totales.monto_total
    if particular or importe <= 0:
        return None

    periodo = attrs.get("periodo")
    es_sueldo = bool(attrs.get("sueldo"))
    tipo_gasto = attrs.get("tipo") or "Ordinario"
    imputaciones = attrs.get("imputaciones") or []
    cuenta_nombre = imputaciones[0].get("cuenta", {}).get("nombre", "Gastos Varios") if imputaciones else "Gastos Varios"
    coef_nombre = imputaciones[0].get("coeficiente", {}).get("nombre", "G FIJOS") if imputaciones else "G FIJOS"

    prov_data = (item.get("relationships", {}).get("proveedor", {}).get("data") or {}).get("attributes", {})
    prov_raw = prov_data.get("nombre") or prov_data.get("primer_nombre") or "Proveedor Consorcio"
    cuit_raw = prov_data.get("identificacion") or None

    detalle = (attrs.get("detalle") or "").strip()
    # Anonymize employee names in detalle or proveedor
    emp_role, emp_tag = anonymize_employee(prov_raw, detalle)
    detalle_clean = re.sub(r"abonado por Javier", "abonado por Encargado", detalle, flags=re.IGNORECASE)

    comp_tipo = attrs.get("comprobante_tipo") or "Sin comprobante"
    comp_nro = attrs.get("comprobante_nro") or "-"
    adj = attrs.get("comprobante_adjunto") or {}
    comp_url = ((adj.get("links") or {}).get("descarga") or {}).get("href")
    if comp_url:
        comp_url = comp_url.replace("\\/", "/")

    cat = map_ca_category(cuenta_nombre, detalle_clean, prov_raw, es_sueldo, tipo_gasto)
    rubro = map_ca_rubro(cuenta_nombre, es_sueldo, tipo_gasto)

    empleado = None
    if cat == "Sueldos y Cargas Sociales":
        if emp_role:
            empleado = emp_role
            proveedor_display = f"Personal del Consorcio ({emp_role})"
            cuit_display = "CUIL Protegido (Ley 25.326)"
            sueldo_bruto = attrs.get("sueldo_bruto")
            bruto_str = f" (Bruto: ${sueldo_bruto:,.2f})" if sueldo_bruto else ""
            concepto = f"{emp_tag} {detalle_clean} - Recibo N° {comp_nro}{bruto_str}"
        else:
            empleado = "Cargas Sociales / Sindicato"
            proveedor_display = prov_raw
            cuit_display = cuit_raw
            comp_str = f" [{comp_tipo} {comp_nro}]" if comp_nro and comp_nro != "-" else ""
            concepto = f"[Cargas Sociales] {prov_raw} - {detalle_clean}{comp_str}"
    else:
        proveedor_display = prov_raw
        cuit_display = cuit_raw
        comp_str = f" [{comp_tipo} {comp_nro}]" if comp_nro and comp_nro != "-" else ""
        concepto = f"{prov_raw} - {detalle_clean}{comp_str}"

    tiene_pagos = bool(attrs.get("tiene_pagos", True))
    saldo_pend = float(attrs.get("saldo") or 0.0)
    estado = "Pagado" if (tiene_pagos and saldo_pend == 0) else ("Pago Parcial" if tiene_pagos and saldo_pend > 0 else "Pendiente de Pago")

    return {
        "id_ca": item.get("id"),
        "periodo": periodo,
        "seccion": estado,
        "rubro": rubro,
        "concepto": concepto,
        "monto": round(importe, 2),
        "categoria": cat,
        "empleado": empleado,
        "proveedor": proveedor_display,
        "cuit": cuit_display,
        "cuenta_contable": cuenta_nombre,
        "coeficiente": coef_nombre,
        "tipo_gasto": tipo_gasto,
        "comprobante_tipo": comp_tipo,
        "comprobante_nro": comp_nro,
        "comprobante_url": comp_url,
        "fecha_emision": attrs.get("fecha_emision") or attrs.get("fecha_creacion"),
        "tiene_pagos": tiene_pagos,
        "saldo_pendiente": round(saldo_pend, 2),
        "administracion": "Fernández - Villasenin"
    }


def transform_ca_prorrateo(prorrateo_payload):
    periodo = prorrateo_payload.get("periodo_cierre")
    records = []
    for row in prorrateo_payload.get("filas_ufs", []):
        uf = int(row["uf_nro"])
        dpto = format_dpto_360(row["uf"])
        pct_a = round(float(row.get("coef_1") or 0.0), 3)
        pct_b = round(float(row.get("coef_4") or 0.0), 4)

        saldo_anterior = round(float(row.get("anterior_saldo") or 0.0), 2)
        pagos_raw = float(row.get("anterior_pagos") or 0.0)
        desc_raw = float(row.get("anterior_descuentos") or 0.0)
        pagos = round(abs(pagos_raw) + abs(desc_raw), 2)
        saldo_mes = round(float(row.get("saldo_deudor_favor") or 0.0), 2)
        deuda = round(saldo_mes, 2) if saldo_mes > 0 else 0.0

        ga_monto = round(float(row.get("ordinarias_1") or 0.0), 2)
        eventual_mes = round(float(row.get("ordinarias_2") or 0.0), 2)
        fondo_monto = round(float(row.get("ordinarias_3") or 0.0), 2)
        gb_monto = round(float(row.get("ordinarias_4") or 0.0), 2)
        particulares = round(float(row.get("gastos_particulares") or 0.0), 2)
        redondeo = round(float(row.get("redondeo") or 0.0), 2)
        interes = round(float(row.get("intereses") or 0.0), 2)
        total_vto1 = round(float(row.get("total_vto1") or 0.0), 2)

        eventual_total = round(eventual_mes + redondeo, 2)
        total_mes = round(ga_monto + gb_monto + fondo_monto + eventual_total + particulares, 2)

        records.append({
            "periodo": periodo,
            "uf": uf,
            "dpto": dpto,
            "ubicacion": dpto,
            "propietario": f"Propietario U.F. {uf}",
            "porcentual": pct_a,
            "saldo_anterior": saldo_anterior,
            "pagos": pagos,
            "saldo_mes": saldo_mes,
            "saldo": saldo_mes,
            "deuda": deuda,
            "gastos_comunes": ga_monto,
            "servicio_seguridad": gb_monto,
            "fondo_reserva": fondo_monto,
            "eventual": eventual_total,
            "gastos_extraordinarios": particulares,
            "total_mes": total_mes,
            "interes_mora": interes,
            "total_a_pagar": total_vto1,
            "ga_pct": pct_a,
            "ga_monto": ga_monto,
            "gb_pct": pct_b,
            "gb_monto": gb_monto,
            "multa": 0.0,
            "gastos_extra": particulares,
            "fondo_operativo_pct": pct_a,
            "fondo_operativo_monto": fondo_monto,
            "red_ajustes": eventual_total,
            "interes": interes,
            "total": total_vto1
        })
    return records


def parse_historical_pdf_prorrateo(filepath, dpto_to_uf_map):
    filename = os.path.basename(filepath)
    m_date = re.search(r"360_(\d{4}-\d{2})_liquidacion\.pdf$", filename)
    if not m_date:
        return []
    periodo = m_date.group(1)
    if periodo >= "2026-08":
        return []

    records = []
    seen_ufs = set()

    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages[:2]:
            words = page.extract_words(x_tolerance=3, y_tolerance=1)
            dpto_anchors = [w for w in words if w["x0"] < 130 and w["text"] in ("356", "360")]
            for anc in sorted(dpto_anchors, key=lambda x: x["top"]):
                row_words = sorted([w for w in words if abs(w["top"] - anc["top"]) <= 3.0], key=lambda x: x["x0"])
                line_str = " ".join(w["text"] for w in row_words)
                m = re.search(r"(\d+[°º]?\s*[A-C]\s*-\s*3\d\d)\s+.*?\s+(\d+[.,]\d+)\s*%\s*(.*)$", line_str)
                if not m:
                    continue
                raw_dpto = m.group(1)
                norm_key = normalize_dpto_key(raw_dpto)
                uf_info = dpto_to_uf_map.get(norm_key)
                if not uf_info:
                    continue
                uf = uf_info["uf"]
                if uf in seen_ufs:
                    continue
                seen_ufs.add(uf)

                dpto = uf_info["dpto"]
                pct = clean_historical_col(m.group(2))
                cols_raw = re.findall(r"(-?\$\s*(?:-[\d.,\s]*|\d[\d.,\s]*|-))", m.group(3))
                cols = [clean_historical_col(c) for c in cols_raw]

                if len(cols) < 9:
                    continue

                if len(cols) == 9:
                    saldo_anterior = cols[0]
                    pagos = 0.0
                    saldo_mes = cols[1]
                    gastos_comunes = cols[2]
                    servicio_seguridad = cols[3]
                    fondo_reserva = cols[4]
                    eventual = cols[5]
                    gastos_extra = 0.0
                    total_mes = cols[6]
                    interes_mora = cols[7]
                    total_a_pagar = cols[8]
                elif len(cols) == 10:
                    saldo_anterior = cols[0]
                    pagos = cols[1]
                    saldo_mes = cols[2]
                    gastos_comunes = cols[3]
                    servicio_seguridad = cols[4]
                    fondo_reserva = cols[5]
                    eventual = cols[6]
                    gastos_extra = 0.0
                    total_mes = cols[7]
                    interes_mora = cols[8]
                    total_a_pagar = cols[9]
                else:
                    saldo_anterior = cols[0]
                    pagos = cols[1]
                    saldo_mes = cols[2]
                    gastos_comunes = cols[3]
                    servicio_seguridad = cols[4]
                    fondo_reserva = cols[5]
                    eventual = cols[6]
                    gastos_extra = cols[7]
                    total_mes = cols[-3]
                    interes_mora = cols[-2]
                    total_a_pagar = cols[-1]

                deuda = round(saldo_mes, 2) if saldo_mes > 0 else 0.0

                records.append({
                    "periodo": periodo,
                    "uf": uf,
                    "dpto": dpto,
                    "ubicacion": dpto,
                    "propietario": f"Propietario U.F. {uf}",
                    "porcentual": pct,
                    "saldo_anterior": saldo_anterior,
                    "pagos": pagos,
                    "saldo_mes": saldo_mes,
                    "saldo": saldo_mes,
                    "deuda": deuda,
                    "gastos_comunes": gastos_comunes,
                    "servicio_seguridad": servicio_seguridad,
                    "fondo_reserva": fondo_reserva,
                    "eventual": eventual,
                    "gastos_extraordinarios": gastos_extra,
                    "total_mes": total_mes,
                    "interes_mora": interes_mora,
                    "total_a_pagar": total_a_pagar,
                    "ga_pct": pct,
                    "ga_monto": gastos_comunes,
                    "gb_pct": 1.4286,
                    "gb_monto": servicio_seguridad,
                    "multa": 0.0,
                    "gastos_extra": gastos_extra,
                    "fondo_operativo_pct": pct,
                    "fondo_operativo_monto": fondo_reserva,
                    "red_ajustes": eventual,
                    "interes": interes_mora,
                    "total": total_a_pagar
                })

    records.sort(key=lambda r: r["uf"])
    return records


def build_morosidad_from_prorrateo(prorrateo_records, periodo):
    """
    Construye el listado de propietarios morosos (deuda histórica sin intereses > $100)
    directamente desde los registros del período o del período siguiente (anterior_saldo + anterior_pagos).
    """
    morosos = []
    for r in prorrateo_records:
        if r["periodo"] == periodo and r["deuda"] >= 100:
            depto_short = r["dpto"].replace(" (Torre ", " - ").replace(")", "")
            morosos.append({
                "uf": str(r["uf"]),
                "depto": depto_short,
                "consorcista": f"Propietario U.F. {r['uf']}",
                "deuda": round(r["deuda"], 2),
                "periodo": periodo
            })
    morosos.sort(key=lambda x: x["deuda"], reverse=True)
    return morosos


def main():
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, "consorcioabierto_raw.json")

    if os.path.exists(cache_path):
        print(f"Cargando caché local de ConsorcioAbierto desde {cache_path}...")
        with open(cache_path, "r", encoding="utf-8") as f:
            ca_bundle = json.load(f)
    else:
        print("Construyendo bundle de ConsorcioAbierto desde payloads extraídos...")
        ca_bundle = {
            "consorcio_id": CONSORCIO_ID,
            "consorcio_nombre": "CONSORCIO DE COPROPIETARIOS EDIFICIO SARMIENTO 356, 358 Y 360",
            "consorcio_cuit": "30-71412062-6",
            "administracion": {
                "nombre": "FERNÁNDEZ - VILLASENIN ADMINISTRADORES DE CONSORCIOS",
                "cuit": "27-29946737-1",
                "matricula": "862",
                "domicilio": "LAVALLE 1388 - CASILLERO 146, San Nicolás, C.A.B.A.",
                "email": "aconsorcios.f.v@gmail.com",
                "telefono": "1159007443",
                "banco": "Banco Galicia CC 0009108-8 044-9",
                "cbu": "0070044320000009108891",
                "alias": "SARMIENTO356.58.60"
            },
            "periodos": {
                "2026-08": {
                    "liquidacion_id": 633528,
                    "gastos": load_step_json(3695),
                    "prorrateo": load_step_json(3900),
                },
                "2026-09": {
                    "liquidacion_id": 645048,
                    "gastos": load_step_json(3677),
                    "prorrateo": load_step_json(3725),
                }
            }
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(ca_bundle, f, indent=2, ensure_ascii=False)
        print(f"Guardado caché reproducible en {cache_path}")

    # 1. Procesar Prorrateo (2026-08 y 2026-09 desde ConsorcioAbierto + 2025-07..2026-07 desde PDFs 360_)
    ca_prorrateo_08 = transform_ca_prorrateo(ca_bundle["periodos"]["2026-08"]["prorrateo"])
    ca_prorrateo_09 = transform_ca_prorrateo(ca_bundle["periodos"]["2026-09"]["prorrateo"])

    # Mapa canónico de Depto -> UF (1..70)
    dpto_to_uf_map = {}
    for r in ca_prorrateo_08:
        key = normalize_dpto_key(r["dpto"])
        dpto_to_uf_map[key] = {"uf": r["uf"], "dpto": r["dpto"]}

    all_prorrateo = []
    hist_files = sorted([
        os.path.join(LIQUIDACIONES_DIR, f)
        for f in os.listdir(LIQUIDACIONES_DIR)
        if f.startswith("360_") and f.endswith("_liquidacion.pdf")
    ])
    for fp in hist_files:
        recs = parse_historical_pdf_prorrateo(fp, dpto_to_uf_map)
        if recs:
            print(f"   [Prorrateo Histórico] {os.path.basename(fp)} -> {len(recs)} U.F.s")
            all_prorrateo.extend(recs)

    all_prorrateo.extend(ca_prorrateo_08)
    print(f"   [Prorrateo ConsorcioAbierto] 2026-08 -> {len(ca_prorrateo_08)} U.F.s")
    all_prorrateo.extend(ca_prorrateo_09)
    print(f"   [Prorrateo ConsorcioAbierto] 2026-09 -> {len(ca_prorrateo_09)} U.F.s")

    with open(PRORRATEO_JSON, "w", encoding="utf-8") as f:
        json.dump({"prorrateo": all_prorrateo}, f, indent=4, ensure_ascii=False)
    print(f"✅ Guardado {PRORRATEO_JSON} con {len(all_prorrateo)} registros totales ({len(all_prorrateo)//70} períodos x 70 UFs).")

    # 2. Actualizar gastos.json
    with open(GASTOS_JSON, "r", encoding="utf-8") as f:
        gastos_db = json.load(f)

    # Filtrar gastos históricos hasta 2026-07 y etiquetar administración
    hist_gastos = [g for g in gastos_db.get("gastos", []) if g.get("periodo", "") <= "2026-07"]
    for g in hist_gastos:
        g.setdefault("administracion", "D&F Administración")

    ca_gastos_08 = []
    for item in ca_bundle["periodos"]["2026-08"]["gastos"].get("data", []):
        tg = transform_ca_expense(item)
        if tg:
            ca_gastos_08.append(tg)

    ca_gastos_09 = []
    for item in ca_bundle["periodos"]["2026-09"]["gastos"].get("data", []):
        tg = transform_ca_expense(item)
        if tg:
            ca_gastos_09.append(tg)

    print(f"   [Gastos ConsorcioAbierto] 2026-08: {len(ca_gastos_08)} ítems -> ${sum(x['monto'] for x in ca_gastos_08):,.2f}")
    print(f"   [Gastos ConsorcioAbierto] 2026-09: {len(ca_gastos_09)} ítems -> ${sum(x['monto'] for x in ca_gastos_09):,.2f}")

    all_gastos = hist_gastos + ca_gastos_08 + ca_gastos_09

    # Limpiar balances históricos (eliminar los 43 registros basura de 326_151_ y conservar los 12 reales de 360_)
    raw_balances = gastos_db.get("balances", [])
    clean_balances_map = {}
    for b in raw_balances:
        p = b.get("periodo", "")
        if "2025-07" <= p <= "2026-07" and b.get("egresos", 0) > 0:
            # Preferir el registro que tiene saldo_banco > 0 (el de 360_)
            if p not in clean_balances_map or b.get("saldo_banco", 0) > clean_balances_map[p].get("saldo_banco", 0):
                clean_balances_map[p] = b

    # Enriquecer balances históricos con recaudado_termino y deuda_acumulada desde prorrateo
    for p, b in clean_balances_map.items():
        p_recs = [r for r in all_prorrateo if r["periodo"] == p]
        if p_recs:
            sum_pagos = round(sum(r["pagos"] for r in p_recs), 2)
            sum_deuda = round(sum(r["deuda"] for r in p_recs), 2)
            b["recaudado_termino"] = sum_pagos
            b["deuda_acumulada"] = sum_deuda
            if p == "2025-07" and b["ingresos"] < 5000000:
                b["ingresos"] = sum_pagos
            b["saldo_disponibilidades"] = round(b.get("saldo_banco", 0.0), 2)
            b["administracion"] = "D&F Administración"

    # Agregar balances oficiales 2026-08 y 2026-09 de ConsorcioAbierto
    clean_balances_map["2026-08"] = {
        "periodo": "2026-08",
        "ingresos": 15703897.79,
        "egresos": 10953099.28,
        "egresos_deuda_anterior": 15297607.28,
        "egresos_caja_total": 20880239.56,
        "saldo_banco": 4960189.97,
        "recaudado_termino": 10708191.79,
        "recaudado_adeudado": 1879135.00,
        "recaudado_intereses": 173194.00,
        "recaudado_no_identificado": 2943377.00,
        "deuda_acumulada": 5693914.00,
        "pasivos_pendientes": 7117257.83,
        "patrimonio_neto": 16272406.99,
        "saldo_disponibilidades": 4960189.97,
        "fondo_reserva_cierre": 4162505.74,
        "cuenta_operativa_cierre": 797684.23,
        "administracion": "Fernández - Villasenin"
    }

    clean_balances_map["2026-09"] = {
        "periodo": "2026-09",
        "ingresos": 15351768.69,
        "egresos": 16695387.84,
        "egresos_deuda_anterior": 5370467.00,
        "egresos_caja_total": 20349586.84,
        "saldo_banco": 4055290.74,
        "recaudado_termino": 13783727.23,
        "recaudado_adeudado": 1060166.69,
        "recaudado_intereses": 115874.77,
        "recaudado_no_identificado": 392000.00,
        "deuda_acumulada": 3189722.63,
        "pasivos_pendientes": 3887790.83,
        "patrimonio_neto": 18125450.00,
        "saldo_disponibilidades": -37628.18,
        "fondo_reserva_cierre": 4055290.74,
        "cuenta_operativa_cierre": -4092918.92,
        "administracion": "Fernández - Villasenin"
    }

    clean_balances = [clean_balances_map[k] for k in sorted(clean_balances_map.keys())]

    # 3. Actualizar extraordinarios
    extraordinarios = [
        e for e in gastos_db.get("extraordinarios", [])
        if e.get("periodo_expensa") not in ("AGOSTO 2026", "SEPTIEMBRE 2026")
    ]
    extraordinarios.extend([
        {
            "periodo_expensa": "AGOSTO 2026",
            "concepto": "LUIS DE LA PAS PAVON RIVEROS - Reparación y pintura contrafrente [Fc. C 0005-00000136]",
            "liquidado": 2340000.0,
            "recaudado": 2264351.24,
            "abonado": 2000000.0,
            "fecha_pago": "07/08/2026",
            "rubro": "Fondo de Reserva / Obra de Pintura",
            "categoria": "Gastos Extraordinarios",
            "comprobante_url": "https://files.consorcioabierto.com/administraciones/1086/comprobantes_gastos_flash/GASTO_FLASH-260907161240306-c216fcc10cedc91a.pdf"
        },
        {
            "periodo_expensa": "SEPTIEMBRE 2026",
            "concepto": "MIX MASTER MAQ (FERRETERÍA FERNOLUZ) - Carro Zorra Carretilla Portabultos Ropal 200 Kg [Fc. B 0002-00262625]",
            "liquidado": 2340000.0,
            "recaudado": 2281813.34,
            "abonado": 107215.0,
            "fecha_pago": "22/09/2026",
            "rubro": "Obras y Equipamiento Extraordinario",
            "categoria": "Gastos Extraordinarios",
            "comprobante_url": "https://files.consorcioabierto.com/administraciones/1086/comprobantes_gastos_flash/GASTO_FLASH-261002135443852-04ef0c91d0714b20.pdf"
        }
    ])

    # 4. Actualizar morosidad (con soporte multi-período y anonimización estricta)
    morosidad_2026_07 = [
        m for m in gastos_db.get("morosidad", [])
        if m.get("periodo") == "2026-07"
    ]
    for m in morosidad_2026_07:
        m["consorcista"] = f"Propietario U.F. {m['uf']}"

    morosidad_2026_08 = build_morosidad_from_prorrateo(all_prorrateo, "2026-08")
    morosidad_2026_09 = build_morosidad_from_prorrateo(all_prorrateo, "2026-09")

    morosidad_por_periodo = {
        "2026-07": morosidad_2026_07,
        "2026-08": morosidad_2026_08,
        "2026-09": morosidad_2026_09,
    }

    # Metadata institucional y de auditoría de transición
    consorcio_meta = {
        "nombre_oficial": "CONSORCIO DE COPROPIETARIOS EDIFICIO SARMIENTO 356, 358 Y 360",
        "cuit": "30-71412062-6",
        "domicilio": "Sarmiento 356 / 358 / 360, Lomas de Zamora, Prov. de Buenos Aires",
        "unidades_funcionales": 70,
        "plataforma_actual": "ConsorcioAbierto (ID Consorcio 27151)",
        "administracion_actual": ca_bundle["administracion"],
        "administracion_anterior": {
            "nombre": "D&F Administración (María Mercedes Deljarano / Pablo Damián Pariano)",
            "cuit": "27-25108998-7",
            "periodo_hasta": "2026-07"
        },
        "pagos_deuda_anterior_agosto_2026": [
            {"periodo_origen": "2026-07", "proveedor": "ARCA (Cargas Sociales Julio 2026)", "comprobante": "2235242956", "fecha_pago": "20/08/2026", "monto": 6206015.70},
            {"periodo_origen": "2026-07", "proveedor": "BASTIDA S.A. SEGURIDAD PRIVADA INTEGRAL", "comprobante": "0004-00000971", "fecha_pago": "14/08/2026", "monto": 4323293.01},
            {"periodo_origen": "2026-07", "proveedor": "SUELDOS PERSONAL JULIO 2026", "comprobante": "Recibos Jul-26", "fecha_pago": "07/08/2026", "monto": 3201690.00},
            {"periodo_origen": "2026-07", "proveedor": "MARÍA MERCEDES DELJARANO (Honorarios D&F)", "comprobante": "0001-00000344 / 345", "fecha_pago": "19/08/2026", "monto": 914000.00},
            {"periodo_origen": "2026-07", "proveedor": "SUTERH / FATERYH", "comprobante": "Jul-26", "fecha_pago": "12/08/2026", "monto": 506408.57},
            {"periodo_origen": "2026-07", "proveedor": "ASCENSORES GUILLEMI INTERIOR S.A.", "comprobante": "0002-00026453", "fecha_pago": "14/08/2026", "monto": 146200.00}
        ],
        "pasivos_pendientes_cierre_2026_09": [
            {"periodo_origen": "2026-07", "proveedor": "ARCA (Saldo Inicial Cargas Sociales)", "comprobante": "1663755454", "saldo_impago": 1571590.83, "observacion": "Deuda heredada gestión anterior"},
            {"periodo_origen": "2026-09", "proveedor": "ARCA (Cargas Sociales Septiembre 2026)", "comprobante": "Estimado s/acceso", "saldo_impago": 1600000.00, "observacion": "Pendiente de clave fiscal ARCA de la nueva administración"},
            {"periodo_origen": "2026-09", "proveedor": "RIVAS MARTÍN CARLOS RAMÓN (Gasto Part. 2°A-356)", "comprobante": "0001-00000074", "saldo_impago": 290000.00, "observacion": "Reimputado a U.F. 7 (2°A - 356)"},
            {"periodo_origen": "2026-09", "proveedor": "LECOS SERVICIOS (Esteban Jesús Linaje)", "comprobante": "0004-00000427", "saldo_impago": 181000.00, "observacion": "Luminarias y cámara domo cochera"},
            {"periodo_origen": "2026-07", "proveedor": "PARIANO PABLO DAMIÁN (D&F)", "comprobante": "0002-00001037", "saldo_impago": 175000.00, "observacion": "Saldo anterior en revisión"},
            {"periodo_origen": "2026-09", "proveedor": "ADM. FERNÁNDEZ - VILLASENIN", "comprobante": "Hon. Sep-26", "saldo_impago": 70000.00, "observacion": "Saldo parcial honorarios"},
            {"periodo_origen": "2026-07", "proveedor": "ASCENSORES GUILLEMI INTERIOR S.A.", "comprobante": "0002-00026453", "saldo_impago": 200.00, "observacion": "Diferencia redondeo Jul-26"}
        ]
    }

    result = {
        "consorcio": "Sarmiento 356-360",
        "consorcio_meta": consorcio_meta,
        "gastos": all_gastos,
        "balances": clean_balances,
        "multas": gastos_db.get("multas", []),
        "extraordinarios": extraordinarios,
        "morosidad": morosidad_2026_09,
        "morosidad_por_periodo": morosidad_por_periodo
    }

    with open(GASTOS_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)

    print(f"✅ Guardado {GASTOS_JSON} con {len(all_gastos)} gastos, {len(clean_balances)} balances limpios y {len(morosidad_2026_09)} morosos actuales.")


if __name__ == "__main__":
    main()
