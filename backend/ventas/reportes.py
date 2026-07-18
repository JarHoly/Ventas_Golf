"""
Generación del PDF "RESUMEN DE MOVIMIENTOS DEL DÍA" con reportlab.
Réplica del formato del Excel de la empresa: header azul, tabla de 11
columnas, fila TOTAL, y resumen por método de pago + Ventas/Gastos.
"""
import io
from datetime import date

from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)
from reportlab.lib.styles import ParagraphStyle

from .models import Movimiento, CierreDia

EMPRESA = "E Cuestas CORP AMERICA C.R. S.A."

# Colores del design system
NAVY = colors.HexColor("#1F3B66")
ROJO = colors.HexColor("#C00000")


def _fmt(valor, negativo=False):
    """1500 -> '1,500.00' · con negativo=True -> '(1,500.00)' (estilo contable)."""
    texto = f"{abs(valor):,.2f}"
    return f"({texto})" if negativo else texto


@api_view(["GET"])
def pdf_resumen_dia(request, fecha):
    """GET /api/reportes/dia/<fecha>/pdf/ -> el PDF del día (solo si está cerrado)."""
    if not CierreDia.objects.filter(fecha=fecha).exists():
        return Response(
            {"detail": "El día debe estar terminado para generar el PDF."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    movimientos = (
        Movimiento.objects.filter(fecha=fecha)
        .select_related("persona", "producto")
        .order_by("numero")
    )

    # ---------- Cálculos ----------
    total_cantidad = sum(m.cantidad for m in movimientos)
    total_ventas = sum(m.total for m in movimientos if m.tipo == "Venta")
    total_gastos = sum(m.total for m in movimientos if m.tipo == "Gasto")
    # Neto del día: ventas suman, gastos restan (como el Excel).
    neto_subtotal = sum(m.subtotal if m.tipo == "Venta" else -m.subtotal for m in movimientos)
    neto_total = sum(m.total if m.tipo == "Venta" else -m.total for m in movimientos)

    # Desglose por método (solo el dinero que ENTRÓ, o sea las ventas).
    metodos = {"Transferencia": 0, "Efectivo": 0, "Sinpe": 0, "Tarjeta": 0}
    for m in movimientos:
        if m.tipo == "Venta":
            metodos[m.metodo] += m.total

    # ---------- Documento ----------
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
        title=f"Resumen de movimientos {fecha}",
    )
    elementos = []

    # Barra de título azul (leading = fontSize para que el texto quede
    # centrado verticalmente en la franja, sin más aire abajo que arriba)
    titulo = Table(
        [[Paragraph(
            "RESUMEN DE MOVIMIENTOS DEL DÍA",
            ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=14, leading=14, textColor=colors.white),
        )]],
        colWidths=[doc.width],
    )
    titulo.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elementos.append(titulo)
    elementos.append(Spacer(1, 4 * mm))

    # Empresa + fecha
    f = date.fromisoformat(fecha)
    encabezado = Table(
        [[
            Paragraph(EMPRESA, ParagraphStyle("e", fontName="Helvetica-Bold", fontSize=10)),
            Paragraph("FECHA:", ParagraphStyle("f1", fontName="Helvetica-Bold", fontSize=10, alignment=2)),
            Paragraph(f.strftime("%d/%m/%Y"), ParagraphStyle("f2", fontName="Helvetica-Bold", fontSize=10, textColor=NAVY)),
        ]],
        colWidths=[doc.width * 0.6, doc.width * 0.25, doc.width * 0.15],
    )
    elementos.append(encabezado)
    # Aclaración de la moneda
    elementos.append(Paragraph(
        "Montos expresados en dólares estadounidenses (USD)",
        ParagraphStyle("usd", fontName="Helvetica-Oblique", fontSize=8, textColor=colors.HexColor("#64748B")),
    ))
    elementos.append(Spacer(1, 3 * mm))

    # ---------- Tabla principal ----------
    cabeceras = ["Cliente", "Tipo", "Movimiento", "Producto", "Método",
                 "Cantidad", "Precio Unit", "Descuento", "SubTotal", "Impuesto", "Total"]
    datos = [cabeceras]
    estilos_filas = []  # estilos por celda (rojos de gastos)

    for idx, m in enumerate(movimientos, start=1):
        es_gasto = m.tipo == "Gasto"
        datos.append([
            m.persona.nombre,
            m.persona.tipo,
            m.tipo,
            m.producto.nombre,
            m.metodo,
            str(m.cantidad),
            _fmt(m.precio_unitario, es_gasto),
            _fmt(m.descuento),
            _fmt(m.subtotal, es_gasto),
            _fmt(0),
            _fmt(m.total, es_gasto),
        ])
        if es_gasto:
            # Pintar de rojo precio, subtotal y total de la fila del gasto.
            for col in (6, 8, 10):
                estilos_filas.append(("TEXTCOLOR", (col, idx), (col, idx), ROJO))

    # Fila TOTAL (neto del día)
    datos.append([
        "TOTAL", "", "", "", "",
        str(total_cantidad), "", "",
        _fmt(neto_subtotal, neto_subtotal < 0),
        "",
        _fmt(neto_total, neto_total < 0),
    ])

    anchos = [0.16, 0.07, 0.08, 0.17, 0.09, 0.06, 0.08, 0.08, 0.08, 0.06, 0.07]
    tabla = Table(datos, colWidths=[doc.width * a for a in anchos], repeatRows=1)
    fila_total = len(datos) - 1
    tabla.setStyle(TableStyle([
        # Cabecera
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        # Cuerpo
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9AA5B1")),
        ("ALIGN", (5, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Filas compactas (estilo Excel): más movimientos por página
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        # Fila TOTAL
        ("BACKGROUND", (0, fila_total), (-1, fila_total), NAVY),
        ("TEXTCOLOR", (0, fila_total), (-1, fila_total), colors.white),
        ("FONTNAME", (0, fila_total), (-1, fila_total), "Helvetica-Bold"),
        *estilos_filas,
    ]))
    elementos.append(tabla)
    elementos.append(Spacer(1, 6 * mm))

    # ---------- Resumen inferior ----------
    negrita = ParagraphStyle("n", fontName="Helvetica-Bold", fontSize=9)
    normal = ParagraphStyle("m", fontName="Helvetica", fontSize=9)
    resumen = Table(
        [
            [Paragraph("Transferencia:", negrita), Paragraph(_fmt(metodos["Transferencia"]), normal),
             Paragraph("Ventas:", negrita), Paragraph(_fmt(total_ventas), normal), ""],
            [Paragraph("Efectivo:", negrita), Paragraph(_fmt(metodos["Efectivo"]), normal),
             Paragraph("Gastos:", negrita), Paragraph(_fmt(total_gastos), normal), ""],
            [Paragraph("Sinpe:", negrita), Paragraph(_fmt(metodos["Sinpe"]), normal), "", "", ""],
            [Paragraph("Tarjeta:", negrita), Paragraph(_fmt(metodos["Tarjeta"]), normal), "", "", ""],
        ],
        colWidths=[doc.width * 0.10, doc.width * 0.12, doc.width * 0.08, doc.width * 0.12, doc.width * 0.58],
    )
    elementos.append(resumen)

    doc.build(elementos)
    buffer.seek(0)

    respuesta = HttpResponse(buffer.read(), content_type="application/pdf")
    respuesta["Content-Disposition"] = f'inline; filename="Resumen_{fecha}.pdf"'
    return respuesta
