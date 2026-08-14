import os
import sys
import json
import datetime
import subprocess

def load_json(filepath):
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

    print(f"[{datetime.datetime.now().isoformat()}] Iniciando script de actualización (Modo: {mode})...")

    # Siempre ejecutar la verificación de servicios (Luz, Agua y Gas)
    print("Ejecutando monitoreo de servicios locales...")
    result = subprocess.run([sys.executable, "check_servicios.py"])
    if result.returncode != 0:
        print("⚠️  check_servicios.py finalizó con errores. El estado de los servicios no fue actualizado, pero el pipeline continúa.")

    if mode == "--all":
        now = datetime.datetime.now()
        # Determinar el período esperado (mes anterior al corriente)
        if now.month == 1:
            expected_period = f"{now.year - 1}-12"
        else:
            expected_period = f"{now.year}-{now.month - 1:02d}"

        print(f"Período de expensas esperado para evaluar/descargar: {expected_period}")

        is_valid = is_period_valid(expected_period)
        is_first_five_days = now.day <= 5

        # Si el período actual es válido Y NO estamos en los primeros 5 días del mes, omitir re-descargas
        if is_valid and not is_first_five_days:
            print(f"El período {expected_period} se encuentra disponible con datos completos (válido). Se omite la descarga repetida.")
        else:
            if is_first_five_days:
                print(f"Período en ventana de publicación (Día 1-5 del mes). Iniciando búsqueda de versiones nuevas o definitivas...")
            elif not is_valid:
                print(f"El período {expected_period} no está cargado o contiene información incompleta/inválida. Buscando actualización...")

            # 1. Ejecutar descarga de PDFs desde el portal de la administración
            try:
                import download_historico
                download_historico.DOWNLOAD_DIR = "liquidaciones"
                download_historico.FORCE_REDOWNLOAD_CURRENT = True
                download_historico.main()
            except Exception as e:
                print("⚠️ Error durante descarga de PDFs:", e)

            # 2. Ejecutar extractores de datos para sincronizar gastos.json y prorrateo.json
            try:
                print("Ejecutando extract_data.py para actualizar la base de gastos...")
                subprocess.run([sys.executable, "extract_data.py"], check=False)
            except Exception as e:
                print("⚠️ Error en extract_data.py:", e)

            try:
                print("Ejecutando extract_prorrateo.py para actualizar la base de prorrateos...")
                subprocess.run([sys.executable, "extract_prorrateo.py"], check=False)
            except Exception as e:
                print("⚠️ Error en extract_prorrateo.py:", e)

            if is_period_valid(expected_period):
                print(f"¡Sincronización exitosa! El período {expected_period} cuenta ahora con información válida y completa.")
            else:
                print(f"Sincronización completada. El período {expected_period} aún no cuenta con liquidación definitiva publicada por la administración.")

if __name__ == "__main__":
    main()
