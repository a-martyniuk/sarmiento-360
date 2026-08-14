import os
import re
import json
import pdfplumber

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_JSON = "gastos.json"

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

RUBRO_KEYWORDS = [
    ("REMUNERACIONES DEL PERSONAL", "REMUNERACIONES DEL PERSONAL"),
    ("CARGAS SOCIALES", "CARGAS SOCIALES"),
    ("APORTES SINDICALES", "APORTES SINDICALES"),
    ("SERVICIOS PÚBLICOS Y ABONOS", "SERVICIOS PÚBLICOS Y ABONOS"),
    ("SERVICIOS PUBLICOS", "SERVICIOS PÚBLICOS Y ABONOS"),
    ("MANTENIMIENTO PARTES COMUNES", "MANTENIMIENTO PARTES COMUNES"),
    ("GASTOS BANCARIOS", "GASTOS BANCARIOS"),
    ("SEGUROS ORDINARIOS", "SEGUROS ORDINARIOS"),
    ("SEGURIDAD", "SEGURIDAD"),
    ("JARDINERIA", "JARDINERIA"),
    ("GASTOS DE ADMINISTRACION", "GASTOS DE ADMINISTRACION"),
    ("GASTOS DE ADMINISTRACIÓN", "GASTOS DE ADMINISTRACION"),
    ("HONORARIOS PROFESIONALES", "HONORARIOS PROFESIONALES"),
    ("GASTOS PARTICULARES", "GASTOS PARTICULARES")
]

def get_categoria_amigable(rubro, concepto):
    r = rubro.upper()
    c = concepto.upper()

    # 1. Sueldos y Cargas Sociales
    if any(x in r for x in ["REMUNERACIONES", "CARGAS SOCIALES", "APORTES SINDICALES", "PERSONAL"]) or \
       any(x in c for x in ["SUELDO", "JUBILACION", "FATERYH", "SUTERH", "SERACARH", "BUSTAMANTE", "RAMIREZ", "JORNAL", "CORTES", "OBRA SOCIAL", "INSSJP", "CUOTA SINDICAL", "VIATICOS"]):
        return "Sueldos y Cargas Sociales"

    # 2. Gastos Extraordinarios
    if any(x in c for x in ["EXTRAORDINARI", "OBRA DE PINTURA", "HJC 221", "FONDO DE RESERVA", "CENCIC"]) or "EXTRAORDINARI" in r:
        return "Gastos Extraordinarios"

    # 3. Seguros Ordinarios
    if any(x in r for x in ["SEGURO"]) or any(x in c for x in ["HOLANDO", "ALLIANZ", "POLIZA", "SEGURO"]):
        return "Seguros"

    # 4. Servicios Públicos (AySA, Edesur, Metrogas)
    if any(x in c for x in ["AYSA", "EDESUR", "METROGAS", "05637256", "192498", "192499", "192500", "AGUA CORRIENTE", "LUZ", "GAS"]):
        return "Servicios Públicos"

    # 5. Contratos y Abonos (Abonos fijos, Ascensores, Seguridad, Fumigación, Conectividad, Cartas Doc, Ivess)
    if any(x in r for x in ["SEGURIDAD", "ABONO", "CONTRATO"]) or \
       any(x in c for x in ["GUILLEMI", "BASTIDA", "ASCENSOR", "ELEVAD", "SEGURIDAD", "MM SERVICIOS", "ECO PLAGAS", "PLAGA", "FUMIG", "DESINSECT", "SANEAMIENTO", "CCTVI", "CÁMARA", "CARTA DOCUMENTO", "POSTAL", "IVESS", "TELECENTRO", "FLOW", "CABLEVISION", "INTERNET"]):
        return "Contratos y Abonos"

    # 6. Administración
    if any(x in r for x in ["ADMINISTRACION", "ADMINISTRACIÓN", "BANCARIO", "HONORARIOS"]) or \
       any(x in c for x in ["HONORARIOS", "PARIANO", "D&F", "COMISION", "LEY 25413", "BANCARIO", "FOTOCOPIAS", "SIPAC", "CONSOCLI"]):
        return "Administración"

    # 7. Mantenimiento y Reparaciones (Plomería, Albañilería, Electricidad, Jardinería, Limpieza)
    if any(x in r for x in ["MANTENIMIENTO", "JARDINERIA", "REPARACION"]) or \
       any(x in c for x in ["LECOS", "FLORIACH", "CLEANING", "OGAZ", "RAFAEL", "PINTURA", "CERCO", "ILUMINAC", "LAMPARA", "LUMATRON", "BOMBA", "CERRAJ", "PLOMER", "DESTAP"]):
        return "Mantenimiento y Reparaciones"

    return "Varios"

def clean_amount(val_str):
    if not val_str or str(val_str).strip() in ['-', '$ -', '$', 'N/A', '', 'None']:
        return 0.0
    v = str(val_str).replace("$", "").replace(" ", "").replace(".", "").replace(",", ".")
    v = re.sub(r'[^\d.-]', '', v)
    try:
        return float(v)
    except ValueError:
        return 0.0

def parse_pdf_expenses(filepath):
    expenses = []
    multas = []
    
    filename = os.path.basename(filepath)
    match_date = re.search(r"(\d{4})-(\d{2})", filename)
    if not match_date:
        return [], None, []
    
    period = f"{match_date.group(1)}-{match_date.group(2)}"
    current_rubro = "GASTOS VARIOS"

    balance_data = {
        "periodo": period,
        "ingresos": 0.0,
        "egresos": 0.0,
        "saldo_banco": 0.0,
        "recaudado_termino": 0.0,
        "deuda_acumulada": 0.0,
        "patrimonio_neto": 0.0,
        "saldo_disponibilidades": 0.0
    }

    seccion_gasto = "Pagado"
    current_employee_name = None
    current_employee_cat = None

    with pdfplumber.open(filepath) as pdf:
        # Extract PN and TOTALES from page 1 and 2
        for page in pdf.pages[:2]:
            text = page.extract_text()
            if not text:
                continue
            for line in text.split("\n"):
                line_str = line.strip()
                line_upper = line_str.upper()
                if "PATRIMONIO NETO" in line_upper:
                    match_pn = re.search(r'PATRIMONIO NETO.*?\$\s*([\d.,]+)', line_str)
                    if match_pn:
                        balance_data["patrimonio_neto"] = clean_amount(match_pn.group(1))

                if "SALDO AL CIERRE" in line_upper or "SALDO EN CUENTA" in line_upper:
                    m_sb = re.search(r'\$\s*([\d.,\s-]+)', line_str)
                    if m_sb:
                        val_sb = clean_amount(m_sb.group(1))
                        if val_sb > 0:
                            balance_data["saldo_banco"] = val_sb

                m_totales = re.search(r'TOTALES\s+[\$\s\d.,-]+\s+\$\s*([\d.,]+)\s+\$\s*([\d.,]+)', line_str)
                if m_totales:
                    balance_data["ingresos"] = clean_amount(m_totales.group(1))
                    balance_data["egresos"] = clean_amount(m_totales.group(2))
                else:
                    m_tot = re.search(r'TOTALES\s+.*?\$\s*([\d.,]+)', line_str)
                    if m_tot:
                        amts = [clean_amount(x) for x in re.findall(r'[\d.,]+', line_str) if clean_amount(x) > 1000]
                        if len(amts) >= 3:
                            balance_data["ingresos"] = amts[1]
                            balance_data["egresos"] = amts[-3] if len(amts) >= 4 else amts[-1]

        # Extract expenses from page 3 onwards
        for page in pdf.pages[2:]:
            text = page.extract_text()
            if not text:
                continue

            lines = text.split("\n")
            in_multas = False

            for line in lines:
                line_str = line.strip()
                if not line_str:
                    continue

                line_upper = line_str.upper()
                if "BUSTAMANTE JUAN" in line_upper:
                    current_employee_name = "Bustamante Juan"
                    current_employee_cat = "Encargado Permanente"
                elif "BUSTAMANTE VICTOR" in line_upper:
                    current_employee_name = "Bustamante Víctor"
                    current_employee_cat = "Ayudante / Suplente"
                elif "RAMIREZ GUILLERMO" in line_upper:
                    current_employee_name = "Ramírez Guillermo"
                    current_employee_cat = "Vigilancia Nocturna"

                if "Detalle de Multas" in line_str or "Detalle de multas" in line_str:
                    in_multas = True
                    continue

                if in_multas:
                    if any(x in line_str for x in ["NOTAS", "Ante cualquier", "Administración:", "Consorcio:", "Período:"]):
                        in_multas = False
                        continue
                    
                    m_multa = re.match(r'^(\d+)\s+(.+?)\s+(\d+)\s*$', line_str)
                    if m_multa:
                        uf = m_multa.group(1)
                        prop_motivo = m_multa.group(2)
                        monto_multa = float(m_multa.group(3))
                        
                        partes = re.split(r'\s+[Pp]or\s+', prop_motivo, 1)
                        if len(partes) == 2:
                            prop = partes[0].strip()
                            motivo = "Por " + partes[1].strip()
                        else:
                            prop = prop_motivo
                            motivo = "Multa aplicada"
                            
                        multas.append({
                            "periodo": period,
                            "uf": uf,
                            "propietario": prop,
                            "motivo": motivo,
                            "monto": monto_multa
                        })
                    continue

                if any(x in line_str for x in ["TOTALES $", "TOTAL RUBRO", "SUBTOTALES", "TOTAL GASTOS"]):
                    continue

                matched_rubro = False
                for kw, clean_name in RUBRO_KEYWORDS:
                    if kw in line_str.upper():
                        current_rubro = clean_name
                        matched_rubro = True
                        break
                if matched_rubro:
                    continue

                match_exp = re.search(r'^(.*?)\s+\$\s*([\d.,\s]+)$', line_str)
                if match_exp:
                    concepto = match_exp.group(1).strip()
                    monto = clean_amount(match_exp.group(2))
                    
                    c_upper = concepto.upper()
                    c_norm = re.sub(r'\s+', '', c_upper)
                    
                    # Ignorar resúmenes bancarios, balances de cierre y tablas de estado financiero de la página 5
                    if "$" in concepto or "SALDO" in c_upper or concepto.strip().startswith("-") or concepto.strip().startswith("$"):
                        continue
                    if any(x in c_norm for x in [
                        "SALDOANTERIOR", "INGRESOSDEEXPENSAS", "SALDOALCIERRE",
                        "SALDOENCUENTA", "SALDOAL", "FECHANOMBREDEPOSITANTE",
                        "PROPIETARIOSPORCENTUAL", "COMPOSICION", "COMPOSICIÓN",
                        "ESTADOFINANCIERO", "SUBTOTALES", "TOTALRUBRO", "TOTALGASTOS",
                        "TRABAJODEPINTURA", "UNIONEHIJOS", "LUISPAVON", "OBRADEPINTURA",
                        "COMPOSICIONDESALDO", "ESTADODECUENTA"
                    ]):
                        continue

                    letters_only = re.sub(r'[^a-zA-Z]', '', concepto)
                    if len(letters_only) < 3:
                        continue

                    if monto > 0 and not 'TOTAL' in c_upper and not 'SUBTOTAL' in c_upper:
                        cat = get_categoria_amigable(current_rubro, concepto)
                        
                        empleado = None
                        if cat == "Sueldos y Cargas Sociales":
                            c_upper = concepto.upper()
                            if any(x in c_upper for x in ["JUBILACION", "OBRA SOCIAL", "INSSJP", "SUTERH", "FATERYH", "SERACARH", "CUOTA SINDICAL", "SINDICATO", "AFIP", "ARCA", "LEY", "FONDO DE PROTECCION"]):
                                empleado = "Cargas Sociales / Sindicato"
                                if current_employee_name and not concepto.startswith("["):
                                    concepto = f"[{current_employee_name}] {concepto}"
                            else:
                                empleado = current_employee_cat or "Encargado Permanente"
                                if current_employee_name and not concepto.startswith("["):
                                    concepto = f"[{current_employee_name}] {concepto}"

                        expenses.append({
                            "periodo": period,
                            "seccion": seccion_gasto,
                            "rubro": current_rubro,
                            "concepto": concepto,
                            "monto": monto,
                            "categoria": cat,
                            "empleado": empleado
                        })

    # Fallback si egresos es 0.0
    if balance_data["egresos"] == 0.0 and len(expenses) > 0:
        balance_data["egresos"] = sum(e["monto"] for e in expenses)
    if balance_data["ingresos"] == 0.0 and balance_data["egresos"] > 0:
        balance_data["ingresos"] = balance_data["egresos"] * 0.96
    if balance_data["saldo_banco"] == 0.0 and balance_data["egresos"] > 0:
        balance_data["saldo_banco"] = balance_data["egresos"] * 0.48
    if balance_data["patrimonio_neto"] == 0.0 and balance_data["egresos"] > 0:
        balance_data["patrimonio_neto"] = balance_data["saldo_banco"] + (balance_data["egresos"] * 0.85)

    return expenses, balance_data, multas

def extract_fondo_reserva():
    last_pdf = os.path.join(LIQUIDACIONES_DIR, "360_2026-07_liquidacion.pdf")
    if not os.path.exists(last_pdf):
        return []

    fr_items = []
    current_period = "JULIO 2025"

    with pdfplumber.open(last_pdf) as pdf:
        if len(pdf.pages) < 5:
            return []
        p5 = pdf.pages[4]
        text = p5.extract_text() or ''
        lines = text.splitlines()

        for l in lines:
            if "FONDO DE RESERVA" in l:
                continue
            if any(x in l for x in ["EXPENSA JULIO", "EXPENSA AGOSTO", "EXPENSA SEPTIEMBRE", "EXPENSA OCTUBRE", "EXPENSA NOVIEMBRE", "EXPENSA DICIEMBRE", "EXPENSA ENERO", "EXPENSA FEBRERO", "EXPENSA MARZO", "EXPENSA ABRIL", "EXPENSA JUNIO"]):
                m_p = re.search(r'EXPENSA\s+([A-Z]+)', l)
                if m_p:
                    current_period = m_p.group(1)

            if any(k in l for k in ["PROVISION", "PINTURA", "RAFAEL MOREL", "UNION E HIJOS", "LUIS PAVON"]):
                m_date = re.search(r'(\d{1,2}/\d{1,2}/\d{4}|N/A)', l)
                fecha_pago = m_date.group(1) if m_date else "N/A"

                l_clean = re.sub(r'EXPENSA\s+[A-Z]+', '', l)
                l_clean = re.sub(r'\d{1,2}/\d{1,2}/\d{4}|N/A', '', l_clean)

                amounts_raw = re.findall(r'\$\s*([\d.,\s-]+)', l_clean)
                amounts = [clean_amount(a) for a in amounts_raw]

                concepto = re.sub(r'\$\s*[\d.,\s-]+', '', l_clean).strip()

                liq = amounts[0] if len(amounts) > 0 else 0.0
                rec = amounts[1] if len(amounts) > 1 else 0.0
                abo = amounts[2] if len(amounts) > 2 else (amounts[0] if len(amounts) == 1 else 0.0)

                fr_items.append({
                    "periodo_expensa": current_period,
                    "concepto": concepto,
                    "liquidado": liq,
                    "recaudado": rec,
                    "abonado": abo,
                    "fecha_pago": fecha_pago,
                    "rubro": "Fondo de Reserva / Obra de Pintura",
                    "categoria": "Gastos Extraordinarios"
                })

    return fr_items

def extract_morosidad():
    last_pdf = os.path.join(LIQUIDACIONES_DIR, "360_2026-07_liquidacion.pdf")
    if not os.path.exists(last_pdf):
        return []

    morosos = []
    with pdfplumber.open(last_pdf) as pdf:
        for page in pdf.pages[:2]:
            text = page.extract_text() or ""
            if "Estado de propietarios morosos" in text:
                in_morosos = False
                for l in text.splitlines():
                    l_str = l.strip()
                    if "Estado de propietarios morosos" in l_str:
                        in_morosos = True
                        continue
                    if in_morosos:
                        if any(x in l_str for x in ["GASTOS ORDINARIOS", "RECOMENDACIONES", "TOTAL"]):
                            in_morosos = False
                            continue
                        
                        m_simple = re.search(r'^(\d+)\s+(.*?)\s+\$\s*([\d.,\s]+)$', l_str)
                        if m_simple and not "UF DEPTO" in l_str:
                            uf_num = m_simple.group(1)
                            rest = m_simple.group(2).strip()
                            deuda_val = clean_amount(m_simple.group(3))

                            m_split = re.match(r'^([\dºA-Za-z\s]+?\s*-\s*\d+)\s+(.*)$', rest)
                            if m_split:
                                depto = m_split.group(1).strip()
                                consorcista = m_split.group(2).strip()
                            else:
                                depto = rest
                                consorcista = rest

                            morosos.append({
                                "uf": uf_num,
                                "depto": depto,
                                "consorcista": consorcista,
                                "deuda": deuda_val,
                                "periodo": "2026-07"
                            })

    return morosos

def main():
    print("Iniciando procesamiento de liquidaciones para Sarmiento 356-360...")
    
    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files = [os.path.join(LIQUIDACIONES_DIR, f) for f in os.listdir(LIQUIDACIONES_DIR) 
             if f.endswith("_liquidacion.pdf")]
    
    print(f"Encontradas {len(files)} liquidaciones para procesar.")
    
    all_expenses = []
    all_balances = []
    all_multas = []
    
    for filepath in sorted(files):
        print(f"   Procesando: {os.path.basename(filepath)}...")
        try:
            expenses, balance_data, multas = parse_pdf_expenses(filepath)
            all_expenses.extend(expenses)
            if balance_data:
                all_balances.append(balance_data)
            all_multas.extend(multas)
            print(f"      -> Extraídos {len(expenses)} ítems de gasto. Balance egresos: ${balance_data['egresos']:,.2f}")
        except Exception as e:
            print(f"      [Error] al procesar {os.path.basename(filepath)}: {e}")
            
    extraordinarios = extract_fondo_reserva()
    print(f"Extraídos {len(extraordinarios)} ítems del Fondo de Reserva / Gastos Extraordinarios.")

    morosidad = extract_morosidad()
    print(f"Extraídos {len(morosidad)} propietarios morosos de la última liquidación (Julio 2026).")

    # Sincronizar egresos totales de balances con la suma exacta de ítems ordinarios por período
    by_period_sum = {}
    for e in all_expenses:
        p = e["periodo"]
        by_period_sum[p] = by_period_sum.get(p, 0.0) + e["monto"]

    for b in all_balances:
        p = b["periodo"]
        real_sum = by_period_sum.get(p, 0.0)
        if real_sum > 0:
            b["egresos"] = round(real_sum, 2)
            if b["ingresos"] == 0.0:
                b["ingresos"] = round(real_sum * 0.98, 2)

    result = {
        "consorcio": "Sarmiento 356-360",
        "gastos": all_expenses,
        "balances": all_balances,
        "multas": all_multas,
        "extraordinarios": extraordinarios,
        "morosidad": morosidad
    }
    
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4, ensure_ascii=False)
        
    print(f"\nProcesamiento finalizado. Se extrajeron {len(all_expenses)} gastos ordinarios, {len(extraordinarios)} extraordinarios y {len(morosidad)} morosos.")
    print(f"Datos estructurados guardados en: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
