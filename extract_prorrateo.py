import os
import re
import json
import pdfplumber
import openpyxl

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_JSON = "prorrateo.json"

EXCEL_MAP = {
    "2025-07": "Landing/Liquidaciones/2025/7 - EXPENSAS SARMIENTO 356-360 - JULIO 2025.xlsx",
    "2025-08": "Landing/Liquidaciones/2025/8 - EXPENSAS SARMIENTO 356-360 - AGOSTO 2025.xlsx",
    "2025-09": "Landing/Liquidaciones/2025/9 - EXPENSAS SARMIENTO 356-360. - SEPTIEMBRE 2025.xlsx",
    "2025-11": "Landing/Liquidaciones/2025/11 - EXPENSAS SARMIENTO 356-360 - NOVIEMBRE 2025(CHECK).xlsx",
    "2025-12": "Landing/Liquidaciones/2025/12 - EXPENSAS SARMIENTO 356-360  DICIEMBRE 2025(CHECK).xlsx",
    "2026-01": "Landing/Liquidaciones/2026/1 - EXPENSAS SARMIENTO 356-360 - ENERO 2026.xlsx",
    "2026-02": "Landing/Liquidaciones/2026/2 - EXPENSAS SARMIENTO 356-360 - FEBRERO 2026.xlsx",
    "2026-03": "Landing/Liquidaciones/2026/3 - EXPENSAS SARMIENTO 356-360 - MARZO 2026.xlsx",
    "2026-04": "Landing/Liquidaciones/2026/4 - EXPENSAS SARMIENTO 356-360 - ABRIL 2026.xlsx",
    "2026-05": "Landing/Liquidaciones/2026/5 - EXPENSAS SARMIENTO 356-360 - MAYO 2026.xlsx",
    "2026-06": "Landing/Liquidaciones/2026/6 - EXPENSAS SARMIENTO 356-360 - JUNIO 2026.xlsx",
    "2026-07": "Landing/Liquidaciones/2026/7 - EXPENSAS SARMIENTO 356 360 - JULIO 2026.xlsx",
}

def clean_amount(val_str):
    if not val_str or str(val_str).strip() in ["-", "$ -", "$", "-%", "%", "None"]:
        return 0.0
    v = str(val_str).replace("$", "").replace(" ", "").replace(".", "").replace(",", ".")
    v = v.replace("%", "")
    is_neg = False
    if "-" in v:
        is_neg = True
        v = v.replace("-", "")
    v = re.sub(r"[^\d.]", "", v)
    try:
        res = float(v)
        return -res if is_neg else res
    except Exception:
        return 0.0

def parse_prorrateo_excel(excel_path, period):
    if not os.path.exists(excel_path):
        return []
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    sheet = wb.worksheets[0]
    records = []
    seen_ufs = set()
    for row in sheet.iter_rows(values_only=True):
        if not row or row[0] is None:
            continue
        try:
            uf = int(row[0])
            if 1 <= uf <= 70 and uf not in seen_ufs:
                seen_ufs.add(uf)
                dpto = str(row[1]).strip() if len(row) > 1 and row[1] else f"UF {uf}"
                propietario = str(row[2]).strip() if len(row) > 2 and row[2] else "S/D"
                pct = clean_amount(row[3]) if len(row) > 3 else 0.0
                if pct > 1.0:
                    pct = pct
                else:
                    pct = round(pct * 100, 3) if pct > 0 else 0.0
                
                saldo_anterior = clean_amount(row[4]) if len(row) > 4 else 0.0
                pagos = clean_amount(row[5]) if len(row) > 5 else 0.0
                saldo = clean_amount(row[6]) if len(row) > 6 else 0.0
                ga_monto = clean_amount(row[7]) if len(row) > 7 else 0.0
                fondo_reserva = clean_amount(row[8]) if len(row) > 8 else 0.0
                
                total = clean_amount(row[-1]) if len(row) > 9 else 0.0
                deuda = saldo if saldo > 0 else 0.0
                
                records.append({
                    "periodo": period,
                    "uf": uf,
                    "dpto": dpto,
                    "propietario": propietario,
                    "saldo_anterior": saldo_anterior,
                    "pagos": pagos,
                    "deuda": deuda,
                    "saldo": saldo,
                    "interes": 0.0,
                    "ga_pct": pct,
                    "ga_monto": ga_monto,
                    "gb_pct": 0.0,
                    "gb_monto": 0.0,
                    "multa": 0.0,
                    "gastos_extra": 0.0,
                    "fondo_operativo_pct": 0.0,
                    "fondo_operativo_monto": fondo_reserva,
                    "red_ajustes": 0.0,
                    "total": total
                })
        except Exception:
            pass
    return records

def parse_prorrateo_pdf(filepath):
    filename = os.path.basename(filepath)
    match_date = re.search(r"(\d{4})-(\d{2})", filename)
    if not match_date:
        return []
    
    period = f"{match_date.group(1)}-{match_date.group(2)}"
    records = []
    seen_ufs = set()
    
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages[:2]:
            words = page.extract_words()
            if not words:
                continue
            
            lines = {}
            for w in words:
                top_key = round(w['top'] / 4.0) * 4.0
                lines.setdefault(top_key, []).append(w)
            
            for top in sorted(lines.keys()):
                line_words = sorted(lines[top], key=lambda x: x['x0'])
                line_text = ' '.join(w['text'] for w in line_words)
                
                match_uf = re.match(
                    r'^(\d{1,2})\s+([\d\w\s°áéíóúÁÉÍÓÚñÑ\-\/]+?)\s+([A-Z0-9\sñÑáéíóúÁÉÍÓÚ.\-\/]+?)\s+([\d,.]+)\s*%\s*(.*)$',
                    line_text
                )
                if match_uf:
                    uf = int(match_uf.group(1))
                    if uf in seen_ufs or not (1 <= uf <= 70):
                        continue
                    
                    dpto = match_uf.group(2).strip()
                    propietario = match_uf.group(3).strip()
                    pct = clean_amount(match_uf.group(4))
                    amounts_str = match_uf.group(5).strip()
                    
                    raw_tokens = [t for t in amounts_str.split(' ') if t and t != '$']
                    amounts = []
                    i = 0
                    while i < len(raw_tokens):
                        tok = raw_tokens[i]
                        if tok == '-' and i + 1 < len(raw_tokens):
                            amounts.append(clean_amount('-' + raw_tokens[i+1]))
                            i += 2
                        elif tok.startswith('-$') or tok.startswith('-'):
                            amounts.append(clean_amount(tok))
                            i += 1
                        else:
                            amounts.append(clean_amount(tok))
                            i += 1
                    
                    saldo_anterior = amounts[0] if len(amounts) > 0 else 0.0
                    pagos = amounts[1] if len(amounts) > 1 else 0.0
                    saldo = amounts[2] if len(amounts) > 2 else 0.0
                    gastos_comunes = amounts[3] if len(amounts) > 3 else 0.0
                    fondo_reserva = amounts[4] if len(amounts) > 4 else 0.0
                    
                    total_a_pagar = amounts[-1] if len(amounts) > 0 else 0.0
                    deuda = saldo if saldo > 0 else 0.0
                    
                    seen_ufs.add(uf)
                    records.append({
                        "periodo": period,
                        "uf": uf,
                        "dpto": dpto,
                        "propietario": propietario,
                        "saldo_anterior": saldo_anterior,
                        "pagos": pagos,
                        "deuda": deuda,
                        "saldo": saldo,
                        "interes": 0.0,
                        "ga_pct": pct,
                        "ga_monto": gastos_comunes,
                        "gb_pct": 0.0,
                        "gb_monto": 0.0,
                        "multa": 0.0,
                        "gastos_extra": 0.0,
                        "fondo_operativo_pct": 0.0,
                        "fondo_operativo_monto": fondo_reserva,
                        "red_ajustes": 0.0,
                        "total": total_a_pagar
                    })
                    
    # Fallback to Excel if PDF returned fewer than 70 UFs
    if len(records) < 70 and period in EXCEL_MAP:
        excel_recs = parse_prorrateo_excel(EXCEL_MAP[period], period)
        if len(excel_recs) >= len(records):
            print(f"      [Fallback Excel] {period}: usando {len(excel_recs)} U.F.s extraídas de Excel")
            return excel_recs
            
    return records

def main():
    print("Iniciando extracción de Estado de Cuentas y Prorrateo de Sarmiento 356-360...")
    
    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files = [os.path.join(LIQUIDACIONES_DIR, f) for f in os.listdir(LIQUIDACIONES_DIR) 
             if f.endswith("_liquidacion.pdf")]
    
    print(f"Encontradas {len(files)} liquidaciones para procesar.")
    
    all_records = []
    for filepath in sorted(files):
        print(f"   Procesando: {os.path.basename(filepath)}...")
        try:
            records = parse_prorrateo_pdf(filepath)
            all_records.extend(records)
            print(f"      -> Extraídas {len(records)} U.F.s")
        except Exception as e:
            print(f"      [Error] al procesar {os.path.basename(filepath)}: {e}")
            
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"prorrateo": all_records}, f, indent=4, ensure_ascii=False)
        
    print(f"\nExtracción de prorrateo finalizada. Se procesaron {len(all_records)} registros totales por U.F.")
    print(f"Datos guardados en: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
