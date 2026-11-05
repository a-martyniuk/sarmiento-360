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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(BASE_DIR, "servicios_status.json")
COMUNICADOS_PATH = os.path.join(BASE_DIR, "data_consorcioabierto", "comunicados.json")


def _make_request(url, timeout=10):
    """Realiza una request HTTP con multiples estrategias SSL para compatibilidad multiplataforma."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    }
    req = urllib.request.Request(url, headers=headers)

    # Estrategia 1: contexto SSL no verificado (Windows / entornos con CA custom)
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            if r.getcode() == 200:
                return r.read().decode('utf-8', errors='ignore')
    except Exception:
        pass

    # Estrategia 2: contexto SSL por defecto sin verificacion de hostname (Linux / Ubuntu CI)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            if r.getcode() == 200:
                return r.read().decode('utf-8', errors='ignore')
    except Exception:
        pass

    return None


def _check_local_comunicados(service_keyword):
    """Verifica si en las circulares oficiales de ConsorcioAbierto hay un aviso reciente de interrupcion."""
    if not os.path.exists(COMUNICADOS_PATH):
        return None
    try:
        with open(COMUNICADOS_PATH, "r", encoding="utf-8") as f:
            comms = json.load(f)
        
        # Filtrar circulares activas que mencionen el servicio y advertencias operativas
        for c in comms:
            if c.get("eliminado"):
                continue
            title = (c.get("titulo") or "").lower()
            msg = (c.get("mensaje") or "").lower()
            combined = title + " " + msg
            if service_keyword.lower() in combined:
                # Comprobar si es un aviso de interrupcion / corte / mantenimiento
                if any(w in combined for w in ["corte", "interrupci", "mantenimiento", "falta de agua", "sin luz", "sin suministro"]):
                    # Verificar frescura de la fecha (si es de los ultimos 10 dias)
                    fecha_str = c.get("fecha") or ""
                    try:
                        c_date = datetime.strptime(fecha_str[:10], "%Y-%m-%d")
                        tz_arg = timezone(timedelta(hours=-3))
                        now = datetime.now(tz_arg).replace(tzinfo=None)
                        if (now - c_date).days <= 10:
                            return {
                                "status": "Alerta",
                                "message": f"Aviso de Administracion: {c.get('titulo')}"
                            }
                    except Exception:
                        pass
    except Exception:
        pass
    return None


def query_edesur_cuts():
    # 1. Comprobar circulares oficiales de administracion
    local_alert = _check_local_comunicados("edesur")
    if local_alert:
        return local_alert

    # 2. Comprobar fuentes web oficiales
    urls = [
        "https://www.argentina.gob.ar/enre/estado-del-servicio-electrico-de-edesur",
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
            "message": "Servicio electrico operando normalmente."
        }
    return {
        "status": "Desconocido",
        "message": "No se pudo verificar el estado del servicio electrico. Revisar manualmente."
    }


def query_aysa_cuts():
    # 1. Comprobar circulares oficiales de administracion
    local_alert = _check_local_comunicados("aysa")
    if local_alert:
        return local_alert

    # 2. Comprobar fuentes web oficiales de AySA
    urls = [
        "https://www.aysa.com.ar/usuarios/interrupcion_servicio/cortes_de_servicio_de_agua",
        "https://www.aysa.com.ar/usuarios/interrupcion_servicio",
        "https://www.aysa.com.ar",
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
    # 1. Comprobar circulares oficiales de administracion
    local_alert = _check_local_comunicados("metrogas")
    if local_alert:
        return local_alert

    # 2. Comprobar portales oficiales de Metrogas y Enargas
    urls = [
        "https://www.metrogas.com.ar",
        "https://www.enargas.gob.ar",
    ]
    checked_any = False
    for url in urls:
        html = _make_request(url)
        if html is None:
            continue
        checked_any = True
        # En gas, verificar avisos de cortes o contingencias masivas
        if re.search(r'Lomas\s+de\s+Zamora', html, re.IGNORECASE) and any(w in html.lower() for w in ['corte', 'interrupci', 'emergencia']):
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
    print("Iniciando auditoria de estado de suministros...")

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

    print(f"Auditoria finalizada. Edesur: {edesur_status['status']} | AySA: {aysa_status['status']} | Metrogas: {metrogas_status['status']}")
    print(f"Resultados exportados a: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
