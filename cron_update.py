import os
import sys
import json
import datetime
import subprocess

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def load_json(filename):
    filepath = os.path.join(SCRIPT_DIR, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def is_period_valid(period):
    """
    Verifica si un período en gastos.json cuenta con información completa y válida:
    - Debe tener al menos 10 registros de gastos procesados.
    - El balance correspondiente debe indicar egresos > 0.
    """
    gastos = load_json("gastos.json")
    if not gastos or "gastos" not in gastos:
        return False

    period_expenses = [e for e in gastos["gastos"] if e.get("periodo") == period]
    if len(period_expenses) < 10:
        return False

    balances = gastos.get("balances", [])
    period_balance = next((b for b in balances if b.get("periodo") == period), None)
    if not period_balance or period_balance.get("egresos", 0.0) <= 0:
        return False

    return True

def main():
    mode = "--services-only"
    if len(sys.argv) > 1:
        mode = sys.argv[1]

    print(f"[{datetime.datetime.now().isoformat()}] Iniciando pipeline de actualización (Modo: {mode})...")

    # Siempre ejecutar la verificación de servicios (Luz, Agua y Gas)
    print("Ejecutando monitoreo de servicios locales (check_servicios.py)...")
    check_servicios_path = os.path.join(SCRIPT_DIR, "check_servicios.py")
    result = subprocess.run([sys.executable, check_servicios_path], cwd=SCRIPT_DIR)
    if result.returncode != 0:
        print("[WARN] check_servicios.py finalizó con advertencias. El pipeline continúa.")
    else:
        print("[OK] Monitoreo de servicios actualizado.")

    if mode == "--all":
        now = datetime.datetime.now()
        # Determinar el período esperado (mes anterior al corriente)
        if now.month == 1:
            expected_period = f"{now.year - 1}-12"
        else:
            expected_period = f"{now.year}-{now.month - 1:02d}"

        print(f"Período de expensas esperado para evaluar/descargar: {expected_period}")

        is_valid = is_period_valid(expected_period)
        is_in_window = now.day <= 12

        # Si el período actual es válido Y NO estamos en la ventana de publicación (días 1 al 12), omitir re-descargas
        if is_valid and not is_in_window:
            print(f"El período {expected_period} se encuentra disponible con datos completos (válido). Se omite la descarga repetida.")
        else:
            if is_in_window:
                print(f"Período en ventana de publicación (Días 1-12 del mes). Buscando versiones nuevas o definitivas...")
            elif not is_valid:
                print(f"El período {expected_period} no está cargado o contiene información incompleta/inválida. Buscando actualización...")

            # Ejecutar sincronización unificada de ConsorcioAbierto + Histórico 360 + IPC + Auditoría Forense
            try:
                extract_path = os.path.join(SCRIPT_DIR, "extract_data.py")
                if os.path.exists(extract_path):
                    print("Ejecutando extract_data.py para validar base histórica 360...")
                    subprocess.run([sys.executable, extract_path], cwd=SCRIPT_DIR, check=False)

                ingest_path = os.path.join(SCRIPT_DIR, "ingest_consorcioabierto.py")
                print("Ejecutando ingest_consorcioabierto.py para sincronizar gastos.json y prorrateo.json...")
                subprocess.run([sys.executable, ingest_path], cwd=SCRIPT_DIR, check=False)

                ipc_path = os.path.join(SCRIPT_DIR, "build_ipc_data.py")
                if os.path.exists(ipc_path):
                    print("Actualizando serie IPC-INDEC en data_ipc_indec.json...")
                    subprocess.run([sys.executable, ipc_path], cwd=SCRIPT_DIR, check=False)

                forensic_path = os.path.join(SCRIPT_DIR, "generate_forensic_audit.py")
                if os.path.exists(forensic_path):
                    print("Actualizando cruces forenses en forensic_audit.json...")
                    subprocess.run([sys.executable, forensic_path], cwd=SCRIPT_DIR, check=False)
            except Exception as e:
                print("[WARN] Error en pipeline de actualización:", e)

            if is_period_valid(expected_period):
                print(f"[OK] Sincronización exitosa: El período {expected_period} cuenta ahora con información válida y completa.")
            else:
                print(f"[INFO] Sincronización completada: El período {expected_period} aún no cuenta con liquidación definitiva publicada por la administración (habitual entre el 5 y 10 del mes).")

if __name__ == "__main__":
    main()
