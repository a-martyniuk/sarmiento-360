import os
import sys
import json

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Tabla Pericial Exacta de las 70 UFs (Ago 2024 – Sep 2026, 26 períodos)
# Fuente: Dictamen firmado Dr. Pablo Américo Parodi (T° 178 F° 152 Leg. 46351/5 CPCEPBA)
# y TABLA_SALDOS_70_DEPTOS_SEGURIDAD.pdf (Total Seguridad 26 meses: $50.561.522,20; 1/70 = $722.307,46/UF).
# Tupla: (porcentual_escritura_pct, saldo_seguridad_a_favor_pesos)
PERICIA_SEGURIDAD_70_UFS = {
    1: (1.5630, -67969.13),
    2: (1.0720, 180287.94),
    3: (1.0320, 200512.55),
    4: (1.0320, 200512.55),
    5: (1.1420, 144894.88),
    6: (1.7240, -149373.18),
    7: (1.6030, -88193.74),
    8: (1.0920, 170175.64),
    9: (1.0320, 200512.55),
    10: (1.0220, 205568.70),
    11: (1.0720, 180287.94),
    12: (1.5530, -62912.98),
    13: (1.5930, -83137.59),
    14: (1.0720, 180287.94),
    15: (1.0220, 205568.70),
    16: (1.0320, 200512.55),
    17: (1.2530, 88771.59),
    18: (1.5530, -62912.98),
    19: (1.7140, -144317.03),
    20: (1.0720, 180287.94),
    21: (1.1930, 119108.50),
    22: (1.1930, 119108.50),
    23: (1.2430, 93827.74),
    24: (1.5630, -67969.13),
    25: (1.5630, -67969.13),
    26: (1.0820, 175231.79),
    27: (1.0220, 205568.70),
    28: (1.0220, 205568.70),
    29: (1.1220, 155007.18),
    30: (1.7540, -164541.64),
    31: (2.2750, -427967.17),
    32: (1.2330, 98883.89),
    33: (1.1820, 124670.27),
    34: (1.3930, 17985.46),
    35: (1.2330, 98883.89),
    36: (1.5730, -73025.28),
    37: (1.5530, -62912.98),
    38: (1.1420, 144894.88),
    39: (1.0320, 200512.55),
    40: (1.0620, 185344.09),
    41: (1.1500, 140849.95),
    42: (1.6130, -93249.89),
    43: (1.9240, -250496.23),
    44: (1.2330, 98883.89),
    45: (1.0820, 175231.79),
    46: (1.1930, 119108.50),
    47: (1.3830, 23041.61),
    48: (1.5530, -62912.98),
    49: (1.9140, -245440.07),
    50: (1.1720, 129726.42),
    51: (1.1720, 129726.42),
    52: (1.9740, -275776.99),
    53: (1.8640, -220159.31),
    54: (1.0220, 205568.70),
    55: (1.0100, 211636.09),
    56: (1.7240, -149373.18),
    57: (1.9340, -255552.38),
    58: (1.0520, 190400.25),
    59: (1.0200, 206579.93),
    60: (1.8640, -220159.31),
    61: (1.7500, -162519.18),
    62: (1.0320, 200512.55),
    63: (1.0220, 205568.70),
    64: (1.9000, -238361.46),
    65: (1.7340, -154429.33),
    66: (1.0220, 205568.70),
    67: (1.0220, 205568.70),
    68: (1.6940, -134204.73),
    69: (4.1390, -1370433.94),
    70: (4.1390, -1370433.94),
}

# Reclamos integrales certificados en Informe_reclamo_UF55_UF59_firmado.pdf (Seguridad + desvío coeficiente general)
RECLAMOS_INTEGRALES_CERTIFICADOS = {
    55: {
        "titular": "Alexis Martyniuk",
        "dni": "33.857.298",
        "porcentual_escritura": 1.0100,
        "porcentual_liquidado_df": 1.0200,
        "porcentual_liquidado_ca": 1.0220,
        "saldo_seguridad_26m": 211636.09,
        "saldo_desvio_alicuota_ordinaria": 34632.96,
        "saldo_reclamo_total": 246269.05,
    },
    59: {
        "titular": "Andrés Martyniuk (Rep. por Alexis Martyniuk)",
        "dni": "31.727.239",
        "porcentual_escritura": 1.0200,
        "porcentual_liquidado_df": 1.0300,
        "porcentual_liquidado_ca": 1.0320,
        "saldo_seguridad_26m": 206579.93,
        "saldo_desvio_alicuota_ordinaria": 34900.36,
        "saldo_reclamo_total": 241480.29,
    },
}


def normalize_supplier(g):
    cat = g.get("categoria", "")
    txt = ((g.get("proveedor") or "") + " " + (g.get("concepto") or "")).upper()

    if cat == "Administración":
        if any(k in txt for k in ["D&F", "FERNÁNDEZ", "FERNANDEZ", "VILLASENIN"]):
            return "Honorarios de Administración (D&F → Fernández-Villasenin)"
        if ("PARIANO" in txt or "LIQUIDACION SUELDO" in txt) and not any(
            x in txt for x in ["RENDICION", "TRASPASO", "INCUMPLIMIENTO"]
        ):
            return "Estudio Contable Pariano (Liquidación Sueldos)"
        return None

    if cat == "Contratos y Abonos":
        if ("MM SERVICIOS" in txt or "BASTIDA" in txt) and not any(
            x in txt for x in ["DIFERENCIA", "PAGO FINAL"]
        ):
            return "Seguridad Privada 24hs (MM Servicios → Bastida S.A.)"
        if ("GUILLEMI" in txt or "GILLEMI" in txt) and "DIFERENCIA" not in txt:
            return "Ascensores Guillemi (Abono Conservación)"
        if "FB SANEAMIENTO" in txt:
            return "FB Saneamiento Ambiental (Desinfección)"
        if any(k in txt for k in ["TELECENTRO", "FLOW", "CABLEVISION"]):
            return "Internet Consorcio (Telecentro → Personal Flow)"
        return None

    if cat == "Seguros":
        if "HOLANDO" in txt:
            return "La Holando Sudamericana (Seguro Integral Consorcio)"
        if "ALLIANZ" in txt:
            return "Allianz Argentina (Seguro Personal / AP)"
        return None

    if cat == "Servicios Públicos":
        if "EDESUR" in txt:
            return "Edesur S.A. (Suministro Eléctrico Cta. 05637256)"
        if "AYSA" in txt:
            return "AySA S.A. (Agua y Cloacas — 3 Cuentas)"
        return None

    if cat == "Sueldos y Cargas Sociales":
        if "[ENCARGADO TITULAR]" in txt and "MENSUAL" in txt and not any(
            x in txt for x in ["SAC", "VACACIONES", "DIAS NO TRABAJADOS", "FINAL"]
        ):
            return "Sueldo Neto Encargado Titular (SUTERH Cat. Permanente)"
        return None

    return None


def main():
    with open(os.path.join(SCRIPT_DIR, "gastos.json"), "r", encoding="utf-8") as f:
        gastos_data = json.load(f)
    with open(os.path.join(SCRIPT_DIR, "prorrateo.json"), "r", encoding="utf-8") as f:
        prorr_data = json.load(f)
    with open(os.path.join(SCRIPT_DIR, "data_ipc_indec.json"), "r", encoding="utf-8") as f:
        ipc_data = json.load(f)

    ipc_idx = {
        row["periodo"]: float(row["indice"])
        for row in ipc_data.get("ipc", [])
        if "periodo" in row and "indice" in row
    }
    balances = {b["periodo"]: b for b in gastos_data.get("balances", [])}
    prorr_list = prorr_data.get("prorrateo", [])

    # 1. CONCILIACIÓN BANCARIA MES A MES (Prorrateo real vs Estado Financiero Banco Galicia)
    prorr_by_p = {}
    for p in prorr_list:
        prorr_by_p.setdefault(p["periodo"], []).append(p)

    conciliacion_rows = []
    tot_recaudado_prorr = 0.0
    tot_ingresos_banco = 0.0
    tot_brecha_positiva_df = 0.0

    for per, rows in sorted(prorr_by_p.items()):
        sum_pagos = sum(r.get("pagos", 0.0) for r in rows)
        b = balances.get(per, {})
        ingresos_banco = b.get("ingresos", 0.0)
        diff = round(sum_pagos - ingresos_banco, 2)
        tot_recaudado_prorr += sum_pagos
        tot_ingresos_banco += ingresos_banco
        if per <= "2026-07" and diff > 1000.0:
            tot_brecha_positiva_df += diff

        if per == "2025-07":
            obs = "Sin cuadro bancario impreso en PDF Jul-25 (cierre verificado en Ago-25: $7.452.640,48)"
        elif per == "2025-11":
            obs = (
                f"Sin PDF Oct-25 emitido por D&F (variación neta Galicia Sep→Nov: +$615.819,65). "
                + (
                    f"En Nov-25: cobranza prorrateo > banco (+${diff:,.2f})"
                    if diff > 1000.0
                    else "Conciliación Nov-25 verificada"
                )
            )
        elif per == "2026-08":
            obs = "Bancarización CBU Galicia 100% (incluye $2.943.377 de transferencias pendientes de identificar UF al cierre)"
        elif per == "2026-09":
            obs = "Bancarización CBU Galicia 100% (compensa transferencias ingresadas en Ago-26 e imputadas a UFs en Sep-26)"
        elif diff > 500000.0:
            obs = f"ALERTA: Cobranza en prorrateo superior a ingresos declarados en Banco Galicia (+${diff:,.2f})"
        elif diff > 1000.0:
            obs = f"Diferencia menor cobranza vs. banco (+${diff:,.2f})"
        elif diff < -1000.0:
            obs = f"Ingresos en Banco Galicia superiores al prorrateo (depósitos diferidos / transf. sin identificar: -${abs(diff):,.2f})"
        else:
            obs = "Conciliación exacta Prorrateo ↔ Extracto Banco Galicia"

        conciliacion_rows.append({
            "periodo": per,
            "recaudado_prorrateo": round(sum_pagos, 2),
            "ingresos_banco": round(ingresos_banco, 2),
            "diferencia_caja": diff,
            "observacion": obs,
        })

    # 2. INTEGRIDAD DE PORCENTUALES
    integridad_rows = []
    for per, rows in sorted(prorr_by_p.items()):
        sum_pct = round(sum(r.get("porcentual", 0.0) for r in rows), 4)
        sum_gb = round(sum(r.get("gb_pct", 0.0) for r in rows), 4)
        desvio = round(100.0 - sum_pct, 4)
        integridad_rows.append({
            "periodo": per,
            "sum_porcentual_legal": sum_pct,
            "desvio_legal_pct": desvio,
            "sum_gb_seguridad_pct": sum_gb,
            "total_unidades": len(rows),
            "alerta_legal": abs(desvio) > 0.01,
            "alerta_seguridad_plana": True,
        })

    # 3. AUDITORÍA PERICIAL DE SEGURIDAD PARA LAS 70 UNIDADES (Ago 2024 – Sep 2026, 26 meses)
    latest_p = sorted(prorr_by_p.keys())[-1]
    latest_ufs = sorted(prorr_by_p[latest_p], key=lambda x: x["uf"])

    PAGADO_1_70_26M = 722307.46
    PCT_APLICADO_1_70 = 1.4286

    seguridad_units = []
    suma_42_damnificadas = 0.0
    suma_28_subsidiadas = 0.0

    for u in latest_ufs:
        uf_num = u["uf"]
        dpto = u.get("dpto", f"UF {uf_num}")
        pct_ca = round(u.get("porcentual", 0.0), 4)
        pct_escritura, saldo_seg = PERICIA_SEGURIDAD_70_UFS[uf_num]
        debido_seg = round(PAGADO_1_70_26M - saldo_seg, 2)

        if saldo_seg > 0:
            suma_42_damnificadas += saldo_seg
            cat = "Perjudicada (Paga de más)"
        elif saldo_seg < 0:
            suma_28_subsidiadas += saldo_seg
            cat = "Subsidiada (Paga de menos)"
        else:
            cat = "Neutra"

        titular_str = f"Propietario U.F. {uf_num}"
        dni_str = ""
        saldo_reclamo_total = saldo_seg
        saldo_desvio_ord = 0.0

        if uf_num in RECLAMOS_INTEGRALES_CERTIFICADOS:
            cert = RECLAMOS_INTEGRALES_CERTIFICADOS[uf_num]
            titular_str = cert["titular"]
            dni_str = cert["dni"]
            saldo_reclamo_total = cert["saldo_reclamo_total"]
            saldo_desvio_ord = cert["saldo_desvio_alicuota_ordinaria"]
        elif uf_num == 69:
            titular_str = "Celina Velayos (14°A - Torre 356)"
        elif uf_num == 70:
            titular_str = "Steven / Gerardo Putz (Ex Consejero · 14°A - Torre 360)"

        unit_entry = {
            "uf": uf_num,
            "dpto": dpto,
            "titular": titular_str,
            "dni": dni_str,
            "porcentual_legal": pct_escritura,
            "porcentual_liquidado_ca": pct_ca,
            "porcentual_aplicado": PCT_APLICADO_1_70,
            "diferencia_porcentual": round(PCT_APLICADO_1_70 - pct_escritura, 4),
            "pagado_26m": PAGADO_1_70_26M,
            "debido_26m": debido_seg,
            "saldo_seguridad_26m": saldo_seg,
            "saldo_desvio_ordinarias_26m": saldo_desvio_ord,
            "saldo_a_favor": saldo_reclamo_total,
            "categoria": cat,
        }
        seguridad_units.append(unit_entry)

    # 4. AUDITORÍA FISCAL ARCA / AFIP (Morel + Rex)
    extraordinarios = gastos_data.get("extraordinarios", [])
    morel_pagos = [ex for ex in extraordinarios if "morel" in ex.get("concepto", "").lower()]
    tot_morel_abonado = round(sum(m.get("abonado", 0.0) for m in morel_pagos), 2)

    morel_audit = {
        "proveedor": "Rafael Morel",
        "rubro": "Pintura y Reparaciones de Fachada Frente",
        "presupuesto_con_factura": 13200000.00,
        "total_abonado_registrado": tot_morel_abonado,
        "sobrecosto_mano_obra": round(tot_morel_abonado - 13200000.00, 2),
        "materiales_frente_asociados": 9061935.00,
        "total_frente_ejecutado": 29171935.00,
        "cantidad_pagos": len(morel_pagos),
        "tipo_comprobantes": (
            "5 transferencias con recibos informales sin firma ni factura (Dic-25 y Feb-26 por $7.900.000) "
            "y 4 transferencias facturadas por tercero monotributista Ignacio Villalba Giménez Fc. C 00001-00000024 a 00000027 (Ene-26 por $12.210.000)"
        ),
        "deuda_reclamada_asamblea_02112026": 6023238.00,
        "estado_asamblea": (
            "RECHAZADA UNÁNIMEMENTE en asamblea del 02/11/2026 por carecer de contrato aprobado, "
            "registrar $6.910.000 de sobrecosto sobre presupuesto y no contar con facturas fiscales con CAE propias ante ARCA/AFIP."
        ),
        "pagos": morel_pagos,
    }

    rex_audit = {
        "proveedor": "Pinturerías Rex S.A.",
        "factura": "FC B 7001-00005828",
        "fecha": "28/07/2025",
        "subtotal_bruto": 461801.23,
        "descuento_comercial_10pct": 46180.12,
        "monto": 415621.11,
        "concepto": "Materiales de impermeabilización y pintura por filtraciones de azotea",
        "origen": (
            "Requerido por Celina Velayos (propietaria de UF 69, 14°A - Torre 356, último piso) "
            "debido a filtraciones estructurales originadas en la terraza común del edificio."
        ),
        "estado_asamblea": (
            "VERIFICADO Y ACLARADO en Asamblea del 02/11/2026 como gasto común de reparación por filtración de terraza en UF 69 (Celina Velayos), descartándose que fuera pintura privada de UF 70."
        ),
    }

    # 5. AUDITORÍA DE PROVEEDORES VS IPC-INDEC
    gastos = gastos_data.get("gastos", [])
    by_norm = {}
    for g in gastos:
        norm = normalize_supplier(g)
        if norm:
            per = g.get("periodo", "")
            by_norm.setdefault(norm, {}).setdefault(per, 0.0)
            by_norm[norm][per] += g.get("monto", 0.0)

    ipc_acum_total = round(((ipc_idx["2026-09"] / ipc_idx["2025-07"]) - 1.0) * 100.0, 2)

    suppliers_audit = []
    for supp, per_dict in by_norm.items():
        pers = sorted(per_dict.keys())
        if len(pers) >= 2:
            p0 = pers[0]
            p1 = pers[-1]
            v0 = per_dict[p0]
            v1 = per_dict[p1]
            pct = round(((v1 - v0) / v0) * 100, 2) if v0 > 0 else 0.0

            idx0 = ipc_idx.get(p0)
            idx1 = ipc_idx.get(p1)
            ipc_span = round(((idx1 / idx0) - 1.0) * 100.0, 2) if (idx0 and idx1 and idx0 > 0) else ipc_acum_total
            desvio = round(pct - ipc_span, 2)

            if desvio > 15.0:
                alerta = "Aumento Superior a Inflación (+)"
            elif desvio < -15.0:
                alerta = "Aumento Inferior a Inflación (-)"
            else:
                alerta = "Alineado a Inflación INDEC (~)"

            suppliers_audit.append({
                "proveedor": supp,
                "periodo_inicio": p0,
                "periodo_fin": p1,
                "monto_inicial": round(v0, 2),
                "monto_final": round(v1, 2),
                "aumento_acumulado_pct": pct,
                "inflacion_ipc_pct": ipc_span,
                "desvio_vs_ipc_pct": desvio,
                "evaluacion": alerta,
            })

    suppliers_audit.sort(key=lambda x: x["desvio_vs_ipc_pct"], reverse=True)

    forensic_audit = {
        "consorcio": "Sarmiento 356/358/360, Lomas de Zamora, PBA",
        "cuit": "30-71412062-6",
        "perito_contable": {
            "nombre": "Dr. Pablo Américo Parodi",
            "titulo": "Contador Público (C.P.C.E.P.B.A.)",
            "matricula": "T° 178 F° 152 · Legajo 46351/5",
            "cuit": "20-32651171-5",
            "periodo_peritado": "Agosto 2024 a Septiembre 2026 (26 períodos)",
        },
        "administradora_actual": {
            "nombre": "Agostina Daniela Fernández (Fernández - Villasenin Administradores de Consorcios)",
            "rpac_matricula": 862,
            "legajo": 279455,
            "cuit": "27-29946737-1",
            "vigencia": "Vigente sin sanciones ante DPPJ / Min. Justicia PBA",
            "email_oficial": "aconsorcios.f.v@gmail.com",
        },
        "conciliacion_bancaria": {
            "resumen": {
                "total_recaudado_prorrateo": round(tot_recaudado_prorr, 2),
                "total_ingresos_banco": round(tot_ingresos_banco, 2),
                "diferencia_total_caja": round(tot_recaudado_prorr - tot_ingresos_banco, 2),
                "brecha_positiva_gestion_anterior": round(tot_brecha_positiva_df, 2),
                "nota_octubre_2025": "Liquidación 2025-10 no publicada en archivo histórico D&F; variación neta Banco Galicia entre cierre Sep-25 ($10.079.401,72) y apertura Nov-25 ($10.695.221,37) = +$615.819,65.",
            },
            "periodos": conciliacion_rows,
        },
        "integridad_porcentuales": {
            "resumen": (
                "La suma histórica de alícuotas ordinarias bajo D&F fue 99,7900% (brecha no asignada de 0,2100% durante 12 liquidaciones), "
                "regularizada a 99,9960% desde 08/2026 en ConsorcioAbierto (persistiendo micro-desvíos contra escrituras como UF 55: 1,022% vs 1,010% y UF 59: 1,032% vs 1,020%). "
                "En paralelo, Gastos B (Seguridad) continúa prorrateándose de forma plana al 1,4286% (1/70) en infracción al Art. 8 del RCP y Art. 2049 CCCN."
            ),
            "periodos": integridad_rows,
        },
        "auditoria_seguridad_70_ufs": {
            "resumen": {
                "periodo_auditado": "Agosto 2024 a Septiembre 2026 (26 meses)",
                "total_seguridad_liquidado_26m": 50561522.20,
                "cargo_plano_por_uf_26m": PAGADO_1_70_26M,
                "total_subsidio_transferido": 6765131.67,
                "suma_aritmetica_42_ufs_rectificadas": round(suma_42_damnificadas, 2),
                "nota_conciliacion_totales": (
                    "El total impreso al pie de TABLA_SALDOS_70_DEPTOS_SEGURIDAD.pdf es $6.765.131,67 (previo a rectificar el coeficiente de escritura de UF 41 de 1,082% a 1,150%, ajuste de -$34.381,86 que deja la suma aritmética de las 42 filas en $6.730.749,81)."
                ),
                "total_unidades": 70,
                "unidades_perjudicadas_chicas": 42,
                "unidades_beneficiadas_grandes": 28,
                "caso_martyniuk": {
                    "titular": "Alexis Martyniuk (UF 55 propia + UF 59 y UC BN por poder)",
                    "uf_55_seguridad": 211636.09,
                    "uf_55_desvio_ordinarias": 34632.96,
                    "uf_55_saldo_favor": 246269.05,
                    "uf_59_seguridad": 206579.93,
                    "uf_59_desvio_ordinarias": 34900.36,
                    "uf_59_saldo_favor": 241480.29,
                    "total_seguridad_pura": 418216.02,
                    "total_saldo_favor": 487749.34,
                },
                "piso_14_unidades_grandes": {
                    "uf_69": {
                        "dpto": "14°A (Torre 356)",
                        "titular": "Celina Velayos",
                        "porcentual_escritura": 4.1390,
                        "saldo_deudor": -1370433.94,
                    },
                    "uf_70": {
                        "dpto": "14°A (Torre 360)",
                        "titular": "Steven / Gerardo Putz (Ex Consejero)",
                        "porcentual_escritura": 4.1390,
                        "saldo_deudor": -1370433.94,
                    },
                },
            },
            "unidades": seguridad_units,
        },
        "auditoria_fiscal_arca": {
            "morel": morel_audit,
            "rex": rex_audit,
        },
        "auditoria_proveedores_vs_ipc": {
            "inflacion_base_ipc_acumulada_pct": ipc_acum_total,
            "proveedores": suppliers_audit,
        },
    }

    output_path = os.path.join(SCRIPT_DIR, "forensic_audit.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(forensic_audit, f, ensure_ascii=False, indent=2)

    print(f"[OK] Guardado {output_path}.")
    print(f"   Seguridad 70 UFs -> Planilla oficial: $6.765.131,67 | Suma 42 UFs rectificadas: ${suma_42_damnificadas:,.2f} | 28 subsidiadas: ${suma_28_subsidiadas:,.2f}")
    print(f"   Rafael Morel -> {len(morel_pagos)} pagos por banco = ${tot_morel_abonado:,.2f} (Sobrecosto s/$13,2M = ${tot_morel_abonado - 13200000.0:,.2f})")


if __name__ == "__main__":
    main()
