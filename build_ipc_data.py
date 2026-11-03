import os
import sys
import json
import datetime
import urllib.request
import ssl

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "data_ipc_indec.json")


def main():
    ctx = ssl._create_unverified_context()
    url = "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&start_date=2024-01-01&limit=60&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

    records = []
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=12) as r:
            res = json.loads(r.read().decode("utf-8"))
        raw_data = res.get("data", [])
        raw_data.sort(key=lambda x: x[0])

        for i, (d, val) in enumerate(raw_data):
            if val is None:
                continue
            period = d[:7]
            var_pct = 0.0
            if i > 0 and raw_data[i - 1][1]:
                prev_val = raw_data[i - 1][1]
                var_pct = round(((val - prev_val) / prev_val) * 100, 2)
            records.append({
                "periodo": period,
                "fecha": d,
                "indice": round(val, 2),
                "variacion_mensual_pct": var_pct,
            })
        print(f"[IPC INDEC] Obtenidos {len(records)} períodos oficiales desde apis.datos.gob.ar")
    except Exception as e:
        print(f"[WARN] No se pudo consultar apis.datos.gob.ar en vivo ({e}). Conservando caché existente.")
        if os.path.exists(OUTPUT_FILE):
            return

    if records and records[-1]["periodo"] == "2026-08":
        last_val = records[-1]["indice"]
        est_val = round(last_val * 1.018, 2)
        records.append({
            "periodo": "2026-09",
            "fecha": "2026-09-01",
            "indice": est_val,
            "variacion_mensual_pct": 1.80,
            "estimado": True,
        })

    base_idx = next((r["indice"] for r in records if r["periodo"] == "2025-07"), None)
    if base_idx:
        for r in records:
            r["inflacion_acumulada_desde_2025_07_pct"] = round(((r["indice"] - base_idx) / base_idx) * 100, 2)

    data_package = {
        "fuente": "INDEC - Instituto Nacional de Estadística y Censos (apis.datos.gob.ar)",
        "serie_id": "148.3_INIVELNAL_DICI_M_26",
        "nombre": "Índice de Precios al Consumidor (IPC) Cobertura Nacional",
        "periodo_base_auditoria": "2025-07",
        "ultima_actualizacion": datetime.date.today().isoformat(),
        "ipc": records,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data_package, f, ensure_ascii=False, indent=2)
    print(f"[OK] Guardado {OUTPUT_FILE} con {len(records)} períodos.")


if __name__ == "__main__":
    main()
