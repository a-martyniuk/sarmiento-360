import json
import os
import sys
import urllib.request
import re
import ssl
from datetime import datetime, timezone, timedelta

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "servicios_status.json")


def _make_request(url, timeout=8):
    """Realiza una request HTTP con múltiples estrategias SSL para compatibilidad entre Windows y Linux."""
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
    req = urllib.request.Request(url, headers=headers)

    # Estrategia 1: contexto SSL permisivo (funciona en Windows)
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return r.read().decode('utf-8', errors='ignore')
    except Exception:
        pass

    # Estrategia 2: contexto SSL predeterminado del sistema (funciona en Linux/Ubuntu)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return r.read().decode('utf-8', errors='ignore')
    except Exception:
        pass

    return None


def query_edesur_cuts():
    urls = [
        "https://www.enre.gov.ar/web/cortes/cortes-edesur.html",
        "https://www.edesur.com.ar/cortes-programados/",
    ]
    checked_any = False
    for url in urls:
        html = _make_request(url)
        if html is None:
            continue
        checked_any = True
        if re.search(r'Lomas\s+de\s+Zamora', html, re.IGNORECASE):
            return {
                "status": "Alerta",
                "message": "Cortes preventivos de Edesur activos en la zona."
            }
    if checked_any:
        return {
            "status": "Normal",
            "message": "Servicio eléctrico operando normalmente."
        }
    return {
        "status": "Desconocido",
        "message": "No se pudo verificar el estado del servicio eléctrico. Revisar manualmente."
    }


def query_aysa_cuts():
    urls = [
        "https://www.aysa.com.ar/usuarios/cortes-de-agua",
        "https://www.aysa.com.ar/usuarios/Cortes-de-agua",
        "https://www.aysa.com.ar/cortes",
    ]
    checked_any = False
    for url in urls:
        html = _make_request(url)
        if html is None:
            continue
        checked_any = True
        if re.search(r'Lomas\s+de\s+Zamora', html, re.IGNORECASE):
            return {
                "status": "Alerta",
                "message": "Obras programadas en la red de AySA en la zona."
            }
    if checked_any:
        return {
            "status": "Normal",
            "message": "Suministro de agua operando normalmente."
        }
    return {
        "status": "Desconocido",
        "message": "No se pudo verificar el estado del suministro de agua. Revisar manualmente."
    }


def query_metrogas_status():
    urls = [
        "https://www.metrogas.com.ar/cortes",
        "https://www.metrogas.com.ar/clientes/cortes-programados",
    ]
    checked_any = False
    for url in urls:
        html = _make_request(url)
        if html is None:
            continue
        checked_any = True
        if re.search(r'Lomas\s+de\s+Zamora', html, re.IGNORECASE):
            return {
                "status": "Alerta",
                "message": "Cortes de gas de Metrogas activos en la zona."
            }
    if checked_any:
        return {
            "status": "Normal",
            "message": "Suministro de gas de Metrogas operando normalmente."
        }
    return {
        "status": "Desconocido",
        "message": "No se pudo verificar el estado del suministro de gas. Revisar manualmente."
    }


def main():
    print("Iniciando auditoría de estado de suministros...")

    edesur_status   = query_edesur_cuts()
    aysa_status     = query_aysa_cuts()
    metrogas_status = query_metrogas_status()

    tz_arg = timezone(timedelta(hours=-3))
    status_data = {
        "actualizado": datetime.now(tz_arg).strftime("%d/%m/%Y %H:%M"),
        "edesur":   edesur_status,
        "aysa":     aysa_status,
        "metrogas": metrogas_status
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(status_data, f, indent=4, ensure_ascii=False)

    print(f"Auditoría finalizada. Edesur: {edesur_status['status']} | AySA: {aysa_status['status']} | Metrogas: {metrogas_status['status']}")
    print(f"Resultados exportados a: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
