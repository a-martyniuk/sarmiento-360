import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import re
import json
import fitz

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIQUIDACIONES_DIR = os.path.join(SCRIPT_DIR, "liquidaciones")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "gastos.json")

CATEGORIAS_REALES = [
    "Sueldos y Cargas Sociales",
    "Seguros",
    "Servicios Públicos",
    "Contratos y Abonos",
    "Administración",
    "Mantenimiento y Reparaciones",
    "Gastos Extraordinarios",
    "Varios",
]

RUBRO_HEADERS = [
    ("REMUNERACIONES DEL PERSONAL", "REMUNERACIONES DEL PERSONAL"),
    ("CARGAS SOCIALES", "CARGAS SOCIALES"),
    ("APORTES SINDICALES", "APORTES SINDICALES"),
    ("SERVICIOS PÚBLICOS Y ABONOS", "SERVICIOS PÚBLICOS Y ABONOS"),
    ("SERVICIOS PUBLICOS Y ABONOS", "SERVICIOS PÚBLICOS Y ABONOS"),
    ("SERVICIOS PUBLICOS", "SERVICIOS PÚBLICOS Y ABONOS"),
    ("MANTENIMIENTO PARTES COMUNES", "MANTENIMIENTO PARTES COMUNES"),
    ("GASTOS BANCARIOS", "GASTOS BANCARIOS"),
    ("SEGUROS ORDINARIOS", "SEGUROS ORDINARIOS"),
    ("GASTOS DE ADMINISTRACION", "GASTOS DE ADMINISTRACION"),
    ("GASTOS DE ADMINISTRACIÓN", "GASTOS DE ADMINISTRACION"),
    ("HONORARIOS PROFESIONALES", "HONORARIOS PROFESIONALES"),
    ("JARDINERIA", "JARDINERIA"),
    ("GASTOS PARTICULARES", "GASTOS PARTICULARES"),
    ("SEGURIDAD", "SEGURIDAD"),
]

STOP_SECTIONS = [
    "SUBTOTALES X GASTOS",
    "TOTAL GASTOS ORDINARIOS",
    "COMPOSICIÓN DE ESTADO FINANCIERO",
    "COMPOSICION DE ESTADO FINANCIERO",
    "FONDO DE RESERVA - LIQUIDADO",
    "PAGOS NO IDENTIFICADOS",
    "DETALLE DE MULTAS",
    "NOVEDADES DEL MES",
    "RECOMENDACIONES GENERALES",
]


def clean_amount(val_str):
    if not val_str:
        return 0.0
    s = str(val_str).strip()
    if s in ("-", "$ -", "$", "N/A", "", "None"):
        return 0.0
    is_neg = s.startswith("-$") or (s.startswith("-") and any(c.isdigit() for c in s))
    v = s.replace("$", "").replace(" ", "")
    if v.startswith("-"):
        is_neg = True
        v = v[1:]
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    else:
        v = v.replace(".", "")
    v = re.sub(r"[^\d.]", "", v)
    try:
        num = float(v)
        return -num if is_neg else num
    except ValueError:
        return 0.0


def get_page_rows(page, y_tol=3.5):
    words = page.get_text("words")
    if not words:
        return []
    words_sorted = sorted(words, key=lambda w: (w[1], w[0]))
    rows = []
    for w in words_sorted:
        if not rows or abs(w[1] - rows[-1]["y"]) > y_tol:
            rows.append({"y": w[1], "words": [w]})
        else:
            rows[-1]["words"].append(w)
    for r in rows:
        r["words"].sort(key=lambda w: w[0])
        r["text"] = " ".join(w[4] for w in r["words"])
        r["left_text"] = " ".join(w[4] for w in r["words"] if w[0] < 295)
        r["right_text"] = " ".join(w[4] for w in r["words"] if w[0] >= 295)
        right_nums = [w for w in r["words"] if w[0] >= 295 and any(ch.isdigit() for ch in w[4])]
        r["amt_x0"] = right_nums[0][0] if right_nums else None
    return rows


def get_categoria_amigable(rubro, concepto, amt_x0=None):
    r = (rubro or "").upper()
    c = (concepto or "").upper()

    # 1. Sueldos y Cargas Sociales
    if any(x in r for x in ["REMUNERACIONES", "CARGAS SOCIALES", "APORTES SINDICALES"]):
        return "Sueldos y Cargas Sociales"

    # 2. Gastos Extraordinarios (columna GASTOS EXTRAORDINARIOS x0 >= 445 en Mantenimiento o keywords de obra fachada)
    if any(x in c for x in [
        "EXTRAORDINARI", "OBRA DE PINTURA", "HJC 221", "FONDO DE RESERVA",
        "CENCIC", "LA UNION E HIJOS", "PROVISION PARA PINTURA", "PROVICION PARA PINTURA"
    ]):
        return "Gastos Extraordinarios"

    # 3. Seguros Ordinarios
    if "SEGURO" in r or any(x in c for x in ["HOLANDO", "ALLIANZ", "POLIZA"]):
        return "Seguros"

    # 4. Servicios Públicos (AySA, Edesur, Metrogas)
    if any(x in c for x in ["AYSA", "EDESUR", "METROGAS", "05637256", "192498", "192499", "192500"]):
        return "Servicios Públicos"

    # 5. Administración (chequear ANTES de Seguridad para que facturas contables del contador no caigan en Seguridad)
    if any(x in r for x in ["ADMINISTRACION", "ADMINISTRACIÓN", "BANCARIOS", "HONORARIOS"]) or \
       any(x in c for x in [
           "HONORARIOS", "HON0RARIOS", "PARIANO", "D&F", "COMISION", "LEY 25413",
           "FOTOCOPIAS", "IMPRESIONES EXPENSAS", "RENDICION FINAL", "TRASPASO DE ADMINISTRAC",
           "TALL GRAF", "LIBRERÍA", "LIBRERIA"
       ]):
        return "Administración"

    # 6. Contratos y Abonos (Seguridad privada, Abono Ascensores mensual, Fumigación, Conectividad, Ivess, Cartas Doc)
    if r == "SEGURIDAD" or any(x in c for x in [
        "MM SERVICIOS DE SEGURIDAD", "BASTIDA", "TELECENTRO", "CABLEVISION", "FLOW",
        "FB SANEAMIENTO", "ECO PLAGAS", "DESINSECT", "DESINFECC", "IVESS",
        "CORREO ARGENTINO", "CARTA DOCUMENTO", "CARTA DOCMENTO", "COUCEIRO"
    ]):
        return "Contratos y Abonos"

    # Distinguir Guillemi Abono Mensual vs Reparación puntual
    if "GUILLEMI" in c or "GILLEMI" in c:
        if any(x in c for x in ["MANTENIM", "MANT ", "DIFERENCIA"]):
            return "Contratos y Abonos"
        return "Mantenimiento y Reparaciones"

    # 7. Mantenimiento y Reparaciones
    if any(x in r for x in ["MANTENIMIENTO", "JARDINERIA", "REPARACION"]) or \
       any(x in c for x in [
           "LECOS", "FLORIACH", "CLEANING", "CLEANNIG", "OGAZ", "PAVON", "PINTURA",
           "CERCO", "ILUMINAC", "LAMPARA", "BOMBA", "CERRAJ", "AYRAM", "PLOMER",
           "DESTAP", "SAMUDIO", "SHELL", "YPF", "LOCATELL", "LOCAELLI", "PROTINCEN",
           "RECCHIA", "DE LA VEGA", "RODRIGUEZ", "IGLESIA", "BLANCO CARLOS", "PURPIL",
           "JORGE OMAR PAZ", "COMBRIL", "ACRI SERGIO"
       ]):
        return "Mantenimiento y Reparaciones"

    return "Varios"


def classify_tipo_gasto(categoria, concepto):
    c = (concepto or "").upper()
    if categoria in ("Sueldos y Cargas Sociales", "Seguros", "Servicios Públicos"):
        if any(k in c for k in ["REEMPLAZO", "SAC", "AGUINALDO", "DIAS NO TRABAJADOS"]):
            return "Variable"
        return "Fijo"
    if categoria == "Contratos y Abonos":
        if any(k in c for k in ["CARTA DOC", "CORREO", "COUCEIRO", "DIFERENCIA"]):
            return "Variable"
        return "Fijo"
    if categoria == "Administración":
        if any(k in c for k in ["TRASPASO", "RENDICION", "ARMADO DE INCUMPLIMIENTO", "LIBRER"]):
            return "Variable"
        return "Fijo"
    return "Variable"


def parse_pdf_expenses(filepath):
    filename = os.path.basename(filepath)
    m_date = re.match(r"^360_(\d{4}-\d{2})_liquidacion\.pdf$", filename)
    if not m_date:
        return [], None, []

    period = m_date.group(1)
    if period > "2026-07":
        return [], None, []

    doc = fitz.open(filepath)
    raw_items = []
    multas = []

    pdf_total_ordinarios = 0.0
    banco_anterior = 0.0
    banco_ingresos = 0.0
    banco_cierre = 0.0
    patrimonio_neto = 0.0

    # Check pages 1 & 2 for Patrimonio Neto if printed
    for pno in range(min(2, len(doc))):
        for r in get_page_rows(doc[pno]):
            tu = r["text"].upper()
            if "PATRIMONIO NETO" in tu and "$" in r["text"]:
                m_pn = re.search(r"PATRIMONIO NETO.*?\$\s*([\d.,]+)", r["text"], re.IGNORECASE)
                if m_pn:
                    patrimonio_neto = clean_amount(m_pn.group(1))

    current_rubro = "GASTOS VARIOS"
    in_emp_payslips = False
    emp_count_done = 0
    current_emp = None
    pending_desc = []
    stop_expenses = False

    IGNORE_LEFT_TOKENS = {
        "", "GASTOS", "PARTICULARES", "EXTRAORDINARIOS", "SEGURIDAD",
        "CHRISTIAN OGAZ", "ALLIANZ GRAL POLIZA", "MM SERVICIOS DE SEGURIDAD ABRIL 2026"
    }

    for pno in range(2, len(doc)):
        rows = get_page_rows(doc[pno])
        for idx, r in enumerate(rows):
            txt = r["text"].strip()
            tu = txt.upper()
            lt = r["left_text"].strip()
            rt = r["right_text"].strip()

            # Capturar Estado Financiero Cuenta Corriente Banco Galicia (Pág. 4 o 5)
            if "SALDO ANTERIOR" in tu and "$" in txt:
                m_amt = re.search(r"\$\s*([\d.,]+)", txt)
                if m_amt and banco_anterior == 0.0:
                    banco_anterior = clean_amount(m_amt.group(1))
            if "INGRESOS DE EXPENSAS" in tu and "$" in txt:
                m_amt = re.search(r"\$\s*([\d.,]+)", txt)
                if m_amt and banco_ingresos == 0.0:
                    banco_ingresos = clean_amount(m_amt.group(1))
            if "SALDO AL CIERRE" in tu and "$" in txt:
                m_amt = re.search(r"\$\s*([\d.,]+)", txt)
                if m_amt and banco_cierre == 0.0:
                    banco_cierre = clean_amount(m_amt.group(1))

            # Capturar TOTAL GASTOS ORDINARIOS impreso en el PDF
            if "TOTAL GASTOS ORDINARIOS" in tu or (
                stop_expenses and pdf_total_ordinarios == 0.0 and tu.endswith("100 %") and "$" in txt
            ):
                m_tot = re.search(r"\$\s*([\d.,]+)\s+100\s*%", txt)
                if m_tot:
                    pdf_total_ordinarios = clean_amount(m_tot.group(1))

            if stop_expenses:
                continue

            if any(s in tu for s in STOP_SECTIONS):
                stop_expenses = True
                continue
            # En 2026-07 la fila SUBTOTALES X GASTOS no tiene etiqueta literal a la izquierda
            if len(re.findall(r"\$\s*[\d.,-]+", rt)) >= 3 and current_rubro == "HONORARIOS PROFESIONALES":
                stop_expenses = True
                continue

            # Ignorar encabezados institucionales de página
            if any(h in tu for h in [
                "CONSORCIO DE PROPIETARIOS", "ADMINISTRACIÓN D&F", "ADMINISTRACION D&F",
                "DETALLE DE GASTOS LIQUIDACIÓN", "PROVEEDOR CONCEPTO IMPORTE",
                "IMPORTE IMPORTE IMPORTE"
            ]):
                continue

            if "TOTAL RUBRO:" in tu:
                pending_desc = []
                in_emp_payslips = False
                continue

            has_right_num = bool(re.search(r"\d[\d.,]*", rt)) and not any(
                col_hdr in rt.upper() for col_hdr in [
                    "GASTOS A", "GASTOS B", "GASTOS COMUNES", "GASTO EVENTUAL",
                    "GASTOS SEGURIDAD", "PARTICULARES", "EXTRAORDINARIOS"
                ]
            )
            if not has_right_num:
                matched_hdr = None
                if not any(x in tu for x in [
                    "FAC ", "FACT", "NRO", "CLIENTE", "POLIZA",
                    "BUSTAMANTE", "RAMIREZ", "REEMPLAZO", "LIQUIDACION DE DIAS"
                ]):
                    for kw, clean_r in RUBRO_HEADERS:
                        if lt.upper().startswith(kw) or tu.startswith(kw):
                            matched_hdr = clean_r
                            break
                if matched_hdr:
                    current_rubro = matched_hdr
                    pending_desc = []
                    if matched_hdr == "REMUNERACIONES DEL PERSONAL":
                        in_emp_payslips = True
                        emp_count_done = 0
                        current_emp = None
                    else:
                        in_emp_payslips = False
                    continue

                if lt.upper().strip() in IGNORE_LEFT_TOKENS:
                    continue

            # Procesamiento de recibos de haberes dentro de REMUNERACIONES DEL PERSONAL
            if current_rubro == "REMUNERACIONES DEL PERSONAL":
                if "BUSTAMANTE JUAN" in tu and "REEMPLAZO" not in tu and "DIAS NO TRABAJADOS" not in tu:
                    current_emp = (
                        "Encargado Permanente",
                        "[Encargado Titular] Liquidación de sueldo mensual"
                    )
                    in_emp_payslips = True
                    continue
                elif "BUSTAMANTE VICTOR" in tu:
                    current_emp = (
                        "Ayudante / Suplente",
                        "[2° Encargado] Liquidación de sueldo mensual"
                    )
                    in_emp_payslips = True
                    continue
                elif "RAMIREZ GUILLERMO" in tu and "REEMPLAZO" not in tu:
                    current_emp = (
                        "Vigilancia Nocturna",
                        "[Personal Nocturno] Liquidación de sueldo mensual"
                    )
                    in_emp_payslips = True
                    continue

                if tu.startswith("TOTALES") and current_emp:
                    amts = [clean_amount(a) for a in re.findall(r"-?\$\s*[\d.,]+", txt)]
                    if len(amts) >= 3:
                        neto = amts[-1]
                        ret = amts[-2]
                        bruto = round(neto + ret, 2)
                        raw_items.append({
                            "rubro": current_rubro,
                            "concepto": f"{current_emp[1]} (Bruto: ${bruto:,.2f})",
                            "monto": neto,
                            "empleado": current_emp[0],
                            "amt_x0": r["amt_x0"],
                        })
                        current_emp = None
                        emp_count_done += 1
                        if emp_count_done >= 3:
                            in_emp_payslips = False
                    continue

                if in_emp_payslips:
                    continue

            # Filas estándar de gasto (incluyendo Cargas Sociales / Sindicales aunque omitan el signo '$')
            m_amt = re.search(r"(-?\$\s*[\d.,]+|\b\d{1,3}(?:\.\d{3})+,\d{2}\b|\b\d+,\d{2}\b)", rt)
            if m_amt and not any(k in rt.upper() for k in ["GASTOS A", "GASTOS B", "GASTOS COMUNES", "TOTAL RUBRO"]):
                monto = clean_amount(m_amt.group(1))
                if abs(monto) > 0:
                    desc_parts = [p for p in pending_desc if p]
                    if lt:
                        desc_parts.append(lt)

                    # Verificar si la fila siguiente es la continuación inferior de una celda envuelta
                    if idx + 1 < len(rows):
                        nxt = rows[idx + 1]
                        nxt_lt = nxt["left_text"].strip()
                        nxt_rt = nxt["right_text"].strip()
                        nxt_tu = nxt["text"].upper().strip()
                        nxt_has_amt = bool(re.search(r"(-?\$\s*[\d.,]+|\b\d{1,3}(?:\.\d{3})+,\d{2}\b)", nxt_rt))
                        nxt_is_hdr = (
                            any(nxt_tu.startswith(kw) for kw, _ in RUBRO_HEADERS)
                            or "TOTAL RUBRO" in nxt_tu
                            or any(s in nxt_tu for s in STOP_SECTIONS)
                        )
                        nxt2_bare_amt = False
                        if idx + 2 < len(rows):
                            r2 = rows[idx + 2]
                            if not r2["left_text"].strip() and re.search(r"-?\$\s*[\d.,]+", r2["right_text"]):
                                nxt2_bare_amt = True
                        if (
                            nxt_lt
                            and not nxt_has_amt
                            and not nxt_is_hdr
                            and not nxt2_bare_amt
                            and nxt_lt.upper() not in IGNORE_LEFT_TOKENS
                        ):
                            desc_parts.append(nxt_lt)
                            rows[idx + 1]["left_text"] = ""

                    concepto = re.sub(r"\s+", " ", " ".join(desc_parts)).strip()
                    pending_desc = []
                    raw_items.append({
                        "rubro": current_rubro,
                        "concepto": concepto,
                        "monto": monto,
                        "empleado": None,
                        "amt_x0": r["amt_x0"],
                    })
            else:
                if lt and lt.upper() not in IGNORE_LEFT_TOKENS:
                    pending_desc.append(lt)

    # Consolidar asientos contables compensatorios (+X / -X exactos, como La Unión e Hijos en 2026-03,
    # o provisión previa SAC en 2026-06) para preservar exactitud al centavo sin montos negativos
    cleaned_items = []
    skip_indices = set()
    for i, it in enumerate(raw_items):
        if i in skip_indices:
            continue
        if it["monto"] > 0:
            # Buscar contraasiento exacto -monto en el mismo rubro (ej. facturas imputadas a Fondo de Reserva)
            paired_exact = None
            for j in range(i + 1, len(raw_items)):
                if j not in skip_indices and raw_items[j]["rubro"] == it["rubro"]:
                    if abs(raw_items[j]["monto"] + it["monto"]) < 0.01:
                        paired_exact = j
                        break
            if paired_exact is not None:
                skip_indices.add(i)
                skip_indices.add(paired_exact)
                continue

            # Buscar descuento parcial inmediato en el mismo rubro (ej. 1ra cuota SAC menos provisión mayo en 2026-06)
            if i + 1 < len(raw_items) and (i + 1) not in skip_indices:
                nxt_it = raw_items[i + 1]
                if nxt_it["rubro"] == it["rubro"] and nxt_it["monto"] < 0 and (it["monto"] + nxt_it["monto"]) > 0:
                    net_val = round(it["monto"] + nxt_it["monto"], 2)
                    it = dict(it)
                    it["concepto"] = (
                        f"{it['concepto']} (${it['monto']:,.2f} neto de {nxt_it['concepto']} -${abs(nxt_it['monto']):,.2f})"
                    )
                    it["monto"] = net_val
                    skip_indices.add(i + 1)

            cleaned_items.append(it)

    expenses = []
    for it in cleaned_items:
        rubro = it["rubro"]
        concepto = it["concepto"]
        monto = round(it["monto"], 2)
        cat = get_categoria_amigable(rubro, concepto, it.get("amt_x0"))
        empleado = it.get("empleado")

        if cat == "Sueldos y Cargas Sociales" and not empleado:
            cu = concepto.upper()
            concepto_anon = concepto
            # Reemplazar nombres completos o parciales del personal propio y suplentes (Ley 25.326)
            emp_patterns = [
                (r"\b(?:SR\.?\s+)?(?:BUSTAM[AE]NTE,?\s+JUAN(?:\s+MANUEL)?|JUAN(?:\s+MANUEL)?\s+BUSTAM[AE]NTE)\b", "Encargado Titular"),
                (r"\b(?:SR\.?\s+)?(?:BUSTAM[AE]NTE,?\s+(?:VICTOR\s+)?JAVIER|(?:VICTOR\s+)?JAVIER\s+BUSTAM[AE]NTE|BUSTAM[AE]NTE,?\s+VICTOR)\b", "2° Encargado"),
                (r"\b(?:SR\.?\s+)?(?:RAM[IÍ]REZ,?\s+GUILLERMO(?:\s+(?:ADRI[AÁ]N|ALBERTO))?|GUILLERMO(?:\s+(?:ADRI[AÁ]N|ALBERTO))?\s+RAM[IÍ]REZ)\b", "Personal Nocturno"),
                (r"\b(?:SR\.?\s+)?FERN[AÁ]NDEZ,?\s+JUAN\s+DOMINGO\b", "Personal Suplente"),
            ]
            for pat_emp, role_lbl in emp_patterns:
                concepto_anon = re.sub(pat_emp, role_lbl, concepto_anon, flags=re.IGNORECASE)
            concepto_anon = re.sub(r"\s+-\s*$", "", re.sub(r"\s{2,}", " ", concepto_anon)).strip()
            if any(k in cu for k in ["REEMPLAZO"]):
                empleado = "Ayudante / Suplente"
                concepto = concepto_anon if concepto_anon.startswith("[") else f"[Reemplazo / Suplencia] {concepto_anon}"
            elif "BUSTAMENTE" in cu or "BUSTAMANTE JUAN" in cu or "JUAN BUSTAMANTE" in cu:
                empleado = "Encargado Permanente"
                concepto = f"[Encargado Titular] {re.sub(r'^Encargado Titular\s*[-–,]?\s*', '', concepto_anon, flags=re.IGNORECASE).strip()}"
            elif "BUSTAMANTE VICTOR" in cu or "BUSTAMANTE JAVIER" in cu or "JAVIER BUSTAMANTE" in cu:
                empleado = "Ayudante / Suplente"
                concepto = f"[2° Encargado] {re.sub(r'^2° Encargado\s*[-–,]?\s*', '', concepto_anon, flags=re.IGNORECASE).strip()}"
            elif "RAMIREZ GUILLERMO" in cu or "RAMÍREZ GUILLERMO" in cu or "GUILLERMO RAMIREZ" in cu:
                empleado = "Vigilancia Nocturna"
                concepto = f"[Personal Nocturno] {re.sub(r'^Personal Nocturno\s*[-–,]?\s*', '', concepto_anon, flags=re.IGNORECASE).strip()}"
            elif any(k in cu for k in ["SAC", "AGUINALDO"]):
                empleado = "Cargas Sociales / Sindicato"
                concepto = concepto_anon if concepto_anon.startswith("[") else f"[SAC / Aguinaldo Plantel] {concepto_anon}"
            else:
                empleado = "Cargas Sociales / Sindicato"
                concepto = concepto_anon if concepto_anon.startswith("[") else f"[Cargas Sociales] {concepto_anon}"

        tipo = classify_tipo_gasto(cat, concepto)
        expenses.append({
            "periodo": period,
            "seccion": "Pagado",
            "estado": "Pagado",
            "tipo": tipo,
            "rubro": rubro,
            "concepto": concepto,
            "monto": monto,
            "categoria": cat,
            "empleado": empleado,
            "administracion": "D&F Administración",
        })

    egresos_sum = round(sum(e["monto"] for e in expenses), 2)
    egresos_final = pdf_total_ordinarios if pdf_total_ordinarios > 0 else egresos_sum

    # En 2025-07 no se imprimió cuadro Galicia en Pág. 5, pero 2025-08 Pág. 5 certifica Saldo al 31-07-2025 = $7.452.640,48
    if period == "2025-07" and banco_cierre == 0.0:
        banco_cierre = 7452640.48

    balance_data = {
        "periodo": period,
        "saldo_anterior_banco": round(banco_anterior, 2),
        "ingresos": round(banco_ingresos, 2),
        "egresos": round(egresos_final, 2),
        "saldo_banco": round(banco_cierre, 2),
        "recaudado_termino": 0.0,
        "deuda_acumulada": 0.0,
        "patrimonio_neto": round(patrimonio_neto, 2),
        "saldo_disponibilidades": round(banco_cierre, 2),
        "administracion": "D&F Administración",
    }

    return expenses, balance_data, multas


def extract_fondo_reserva():
    last_pdf = os.path.join(LIQUIDACIONES_DIR, "360_2026-07_liquidacion.pdf")
    if not os.path.exists(last_pdf):
        return []

    doc = fitz.open(last_pdf)
    if len(doc) < 5:
        return []

    fr_items = []
    current_period = "JULIO 2025"
    in_fr = False

    MONTHS_FR = [
        "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE",
        "DICIEMBRE", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO"
    ]

    PERIOD_TO_ISO = {
        "JULIO 2025": "2025-07",
        "AGOSTO 2025": "2025-08",
        "SEPTIEMBRE 2025": "2025-09",
        "OCTUBRE 2025": "2025-10",
        "NOVIEMBRE 2025": "2025-11",
        "DICIEMBRE 2025": "2025-12",
        "ENERO 2026": "2026-01",
        "FEBRERO 2026": "2026-02",
        "MARZO 2026": "2026-03",
        "ABRIL 2026": "2026-04",
        "MAYO 2026": "2026-05",
        "JUNIO 2026": "2026-06",
    }

    seen_7m_provisions = 0

    for r in get_page_rows(doc[4]):
        l = r["text"].strip()
        lu = l.upper()
        if "FONDO DE RESERVA - LIQUIDADO" in lu:
            in_fr = True
            continue
        if not in_fr:
            continue
        if "PAGOS NO IDENTIFICADOS" in lu or lu.startswith("TOTALES"):
            break

        for mname in MONTHS_FR:
            if f"EXPENSA {mname}" in lu:
                yr = "2025" if mname in ("JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE") else "2026"
                current_period = f"{mname} {yr}"
                break

        if any(k in lu for k in ["PROVISION", "PINTURA", "RAFAEL MOREL", "UNION E HIJOS", "LUIS PAVON"]):
            m_date = re.search(r"(\d{1,2}/\d{1,2}/\d{4}|N/A)", l)
            fecha_pago = m_date.group(1) if m_date else "N/A"

            l_clean = re.sub(r"EXPENSA\s+[A-Z]+", "", l, flags=re.IGNORECASE)
            l_clean = re.sub(r"\d{1,2}/\d{1,2}/\d{4}|N/A", "", l_clean)

            amounts_raw = re.findall(r"\$\s*([\d.,-]+)", l_clean)
            amounts = [clean_amount(a) for a in amounts_raw]
            concepto = re.sub(r"\$\s*[\d.,-]+", "", l_clean).strip()
            concepto = re.sub(r"\s+", " ", concepto)

            liq = amounts[0] if len(amounts) > 0 else 0.0
            rec = amounts[1] if len(amounts) > 1 else 0.0
            abo = amounts[2] if len(amounts) > 2 else (amounts[0] if len(amounts) == 1 else 0.0)

            # Alinear celdas combinadas verticalmente (EXPENSA DICIEMBRE/ENERO/FEBRERO/MARZO/ABRIL)
            if liq == 7000000.0:
                seen_7m_provisions += 1
                if seen_7m_provisions == 1:
                    current_period = "DICIEMBRE 2025"
                elif seen_7m_provisions == 2:
                    current_period = "ENERO 2026"
                elif seen_7m_provisions == 3:
                    current_period = "FEBRERO 2026"
                elif seen_7m_provisions == 4:
                    current_period = "MARZO 2026"

            if "/12/2025" in fecha_pago:
                current_period = "DICIEMBRE 2025"
            elif "/01/2026" in fecha_pago:
                current_period = "ENERO 2026"
            elif "/02/2026" in fecha_pago:
                current_period = "FEBRERO 2026"
            elif "/03/2026" in fecha_pago:
                current_period = "MARZO 2026"
            elif "/04/2026" in fecha_pago:
                current_period = "ABRIL 2026"
            elif "/06/2026" in fecha_pago:
                current_period = "JUNIO 2026"

            # Cruce pericial INFORME_PINTURA_Y_SOBRECOSTOS_MOREL.pdf (Pág. 2):
            # El giro de $3.300.000 del 28-30/01/2026 (imputado erróneamente como Unión e Hijos en el cuadro D&F)
            # corresponde al 9° pago bancario de mano de obra de Rafael Morel (Fc. C 00001-00000027 Villalba Giménez).
            observacion = None
            if fecha_pago == "28/01/2026" and abo == 3300000.0 and "UNION E HIJOS" in concepto.upper():
                concepto = "RAFAEL MOREL TRABAJO DE PINTURA (Fc. C 00001-00000027 Ignacio Villalba Giménez; mal rotulado Unión e Hijos por D&F)"
                observacion = "9° pago bancario de mano de obra fachada frente verificado en pericia contable (total Morel: $20.110.000,00)"

            item_fr = {
                "periodo_expensa": current_period,
                "periodo": PERIOD_TO_ISO.get(current_period, current_period),
                "concepto": concepto,
                "liquidado": liq,
                "recaudado": rec,
                "abonado": abo,
                "fecha_pago": fecha_pago,
                "rubro": "Fondo de Reserva / Obra de Pintura",
                "categoria": "Gastos Extraordinarios",
            }
            if observacion:
                item_fr["observacion_auditoria"] = observacion
            fr_items.append(item_fr)

    return fr_items


def main():
    print("Iniciando procesamiento histórico PyMuPDF para Sarmiento 356, 358 y 360...")

    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files = sorted([
        os.path.join(LIQUIDACIONES_DIR, f)
        for f in os.listdir(LIQUIDACIONES_DIR)
        if re.match(r"^360_\d{4}-\d{2}_liquidacion\.pdf$", f) and f <= "360_2026-07_liquidacion.pdf"
    ])

    print(f"Encontradas {len(files)} liquidaciones históricas de Sarmiento 356-360 (2025-07 a 2026-07).")

    all_expenses = []
    all_balances = []
    all_multas = []

    for filepath in files:
        fname = os.path.basename(filepath)
        expenses, balance_data, multas = parse_pdf_expenses(filepath)
        all_expenses.extend(expenses)
        if balance_data:
            all_balances.append(balance_data)
        all_multas.extend(multas)
        sum_items = round(sum(e["monto"] for e in expenses), 2)
        diff = round(sum_items - balance_data["egresos"], 2)
        print(
            f"   [OK] {fname}: {len(expenses):2d} ítems | Suma=${sum_items:13,.2f} | "
            f"Total PDF=${balance_data['egresos']:13,.2f} (dif=${diff:+.2f}) | "
            f"Banco Ing=${balance_data['ingresos']:12,.2f} | Cierre=${balance_data['saldo_banco']:12,.2f}"
        )

    extraordinarios = extract_fondo_reserva()
    print(f"Extraídos {len(extraordinarios)} movimientos históricos del Fondo de Reserva / Pintura.")

    result = {
        "consorcio": "Sarmiento 356-360",
        "gastos": all_expenses,
        "balances": all_balances,
        "multas": all_multas,
        "extraordinarios": extraordinarios,
        "morosidad": [],
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)

    print(f"\nExtracción histórica finalizada: {len(all_expenses)} gastos ordinarios exactos en {OUTPUT_JSON}.")


if __name__ == "__main__":
    main()
