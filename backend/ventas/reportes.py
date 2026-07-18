"""
PDF "RESUMEN DE MOVIMIENTOS DEL DÍA" — versión dashboard.
Réplica del diseño de la empresa: banner de título, tarjetas de totales,
gráfico de evolución por método, tabla de detalle, dona de distribución,
observaciones y pie de página con numeración.
"""
import io
from datetime import date, timedelta
from pathlib import Path

from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics.shapes import Drawing, Rect, Circle, String
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.charts.piecharts import Pie

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .models import Movimiento, CierreDia

EMPRESA = "E Cuestas CORP AMERICA C.R. S.A."

# ----- Fuente Inter (la del design system). Si faltaran los .ttf, cae a Helvetica. -----
_FUENTES = Path(__file__).resolve().parent / "fonts"
try:
    pdfmetrics.registerFont(TTFont("Inter", str(_FUENTES / "Inter-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Inter-Bold", str(_FUENTES / "Inter-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Inter-Italic", str(_FUENTES / "Inter-Italic.ttf")))
    F_NORMAL, F_NEGRITA, F_ITALICA = "Inter", "Inter-Bold", "Inter-Italic"
except Exception:
    F_NORMAL, F_NEGRITA, F_ITALICA = "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"

# ----- Paleta (design system del reporte) -----
NAVY = colors.HexColor("#132F63")
AZUL_CLARO = colors.HexColor("#37A6F5")
VERDE = colors.HexColor("#1FA35C")
ROJO = colors.HexColor("#D62828")
MORADO = colors.HexColor("#7B3FA9")
AZUL = colors.HexColor("#1F6FEB")
GRIS = colors.HexColor("#64748B")
BORDE = colors.HexColor("#D8E0EC")
ZEBRA = colors.HexColor("#F5F8FC")

COLOR_METODO = {"Transferencia": AZUL, "Efectivo": VERDE, "Tarjeta": ROJO, "Sinpe": MORADO}
METODOS = ["Transferencia", "Efectivo", "Tarjeta", "Sinpe"]


def _fmt(valor, negativo=False):
    """1500 -> '1,500.00' · negativo (por bandera O por signo) -> '(1,500.00)'."""
    texto = f"{abs(valor):,.2f}"
    return f"({texto})" if (negativo or valor < 0) else texto


def _p(texto, tam=8, color=colors.black, negrita=False, italica=False, alin=0, leading=None):
    """Atajo para crear un Paragraph con estilo."""
    fuente = F_NEGRITA if negrita else (F_ITALICA if italica else F_NORMAL)
    return Paragraph(texto, ParagraphStyle(
        "s", fontName=fuente, fontSize=tam, textColor=color,
        alignment=alin, leading=leading or tam + 2,
    ))


# ---------- Pie de página en TODAS las páginas (con "Página X de Y") ----------
class _CanvasNumerado(pdfcanvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._paginas = []

    def showPage(self):
        self._paginas.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._paginas)
        for estado in self._paginas:
            self.__dict__.update(estado)
            self._dibujar_pie(total)
            super().showPage()
        super().save()

    def _dibujar_pie(self, total):
        ancho, _ = landscape(A4)
        self.setFillColor(NAVY)
        self.rect(0, 0, ancho, 9 * mm, fill=1, stroke=0)
        self.setFillColor(colors.white)
        self.setFont(F_NORMAL, 8)
        self.drawString(8 * mm, 3.2 * mm, EMPRESA)
        self.drawRightString(ancho - 8 * mm, 3.2 * mm, f"Página {self._pageNumber} de {total}")


# ---------- Piezas gráficas ----------
def _icono_circulo(color, glifo):
    d = Drawing(24, 24)
    d.add(Circle(12, 12, 11, fillColor=color, strokeColor=None))
    d.add(String(12, 8, glifo, fontName=F_NEGRITA, fontSize=12,
                 fillColor=colors.white, textAnchor="middle"))
    return d


def _icono_titulo():
    """Círculo blanco con barras de gráfico (el logo del banner)."""
    d = Drawing(30, 30)
    d.add(Circle(15, 15, 14, fillColor=colors.white, strokeColor=None))
    for i, alto in enumerate((6, 10, 14)):
        d.add(Rect(7.5 + i * 5.5, 7, 3.5, alto, fillColor=NAVY, strokeColor=None))
    return d


def _tarjeta(ancho, etiqueta, valor, sub, color, glifo):
    """Una tarjeta de resumen: icono circular + etiqueta + número grande."""
    textos = Table(
        [[_p(etiqueta, 6, GRIS, negrita=True)],
         [_p(valor, 13, color, negrita=True, leading=14)],
         [_p(sub, 7, GRIS)]],
        colWidths=[ancho - 42],
    )
    textos.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    tarjeta = Table([[_icono_circulo(color, glifo), textos]], colWidths=[32, ancho - 32])
    tarjeta.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (0, 0), 6),
    ]))
    return tarjeta


DIAS_GRAFICO = 7  # el día del reporte + los 6 anteriores


def _grafico_evolucion(ancho, alto, fecha_reporte):
    """Comparación de los últimos días: una línea por método de pago,
    con el neto (ventas − gastos) de cada día."""
    d = Drawing(ancho, alto)

    # Leyenda arriba
    x = 6
    for metodo in METODOS:
        d.add(Rect(x, alto - 10, 7, 5, fillColor=COLOR_METODO[metodo], strokeColor=None))
        d.add(String(x + 10, alto - 9.5, metodo, fontName=F_NORMAL, fontSize=5.5, fillColor=GRIS))
        x += 10 + 5.5 * 0.55 * len(metodo) + 12

    # Neto por método de cada uno de los últimos días (una sola consulta).
    dias = [fecha_reporte - timedelta(days=i) for i in range(DIAS_GRAFICO - 1, -1, -1)]
    neto = {m: {dia: 0.0 for dia in dias} for m in METODOS}
    consulta = Movimiento.objects.filter(fecha__range=(dias[0], dias[-1]))
    for mov in consulta:
        monto = float(mov.total) if mov.tipo == "Venta" else -float(mov.total)
        neto[mov.metodo][mov.fecha] += monto

    lc = HorizontalLineChart()
    lc.x, lc.y = 26, 14
    lc.width, lc.height = ancho - 38, alto - 34
    lc.data = [tuple(neto[m][dia] for dia in dias) for m in METODOS]
    for i, m in enumerate(METODOS):
        lc.lines[i].strokeColor = COLOR_METODO[m]
        lc.lines[i].strokeWidth = 1.4
    # Eje X con las fechas (dd/mm)
    lc.categoryAxis.categoryNames = [dia.strftime("%d/%m") for dia in dias]
    lc.categoryAxis.labels.fontSize = 5
    lc.categoryAxis.labels.fontName = F_NORMAL
    # tickShift: dibuja la rayita en el CENTRO de cada casilla (alineada con
    # la fecha y el punto de la línea), no en el borde.
    lc.categoryAxis.tickShift = 1
    lc.valueAxis.labels.fontSize = 5
    lc.valueAxis.labels.fontName = F_NORMAL
    d.add(lc)
    return d


def _dona_metodos(neto_por_metodo):
    """Dona de distribución por método (tamaño de porción = valor absoluto)."""
    d = Drawing(95, 95)
    datos = [(m, neto_por_metodo[m]) for m in METODOS if neto_por_metodo[m] != 0]
    if not datos:
        d.add(String(47, 45, "Sin datos", fontName=F_NORMAL, fontSize=7, fillColor=GRIS,
                     textAnchor="middle"))
        return d
    dona = Pie()
    dona.x, dona.y = 10, 10
    dona.width = dona.height = 75
    dona.data = [abs(float(v)) for _, v in datos]
    dona.innerRadiusFraction = 0.45
    dona.slices.strokeColor = colors.white
    dona.slices.strokeWidth = 1
    for i, (m, _) in enumerate(datos):
        dona.slices[i].fillColor = COLOR_METODO[m]
    d.add(dona)
    return d


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
    neto_subtotal = sum(m.subtotal if m.tipo == "Venta" else -m.subtotal for m in movimientos)
    neto_total = total_ventas - total_gastos

    # Neto por método (ventas suman, gastos restan) — como el reporte de la empresa.
    neto_por_metodo = {m: 0 for m in METODOS}
    for m in movimientos:
        neto_por_metodo[m.metodo] += m.total if m.tipo == "Venta" else -m.total

    # ---------- Documento ----------
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=8 * mm, rightMargin=8 * mm,
        topMargin=8 * mm, bottomMargin=14 * mm,
        title=f"Resumen de movimientos {fecha}",
    )
    W = doc.width
    elementos = []

    # ============ ENCABEZADO ============
    f = date.fromisoformat(fecha)

    titulo_textos = Table(
        [[_p("RESUMEN DE", 12, colors.white, negrita=True, leading=13)],
         [_p("MOVIMIENTOS DEL DÍA", 15, AZUL_CLARO, negrita=True, leading=16)]],
        colWidths=[W * 0.40 - 44],
    )
    titulo_textos.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    banner = Table([[_icono_titulo(), titulo_textos]], colWidths=[40, W * 0.40 - 40])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (0, 0), 8),
    ]))

    bloque_empresa = Table(
        [[_p(EMPRESA, 12, NAVY, negrita=True)],
         [_p("Montos expresados en dólares estadounidenses (USD)", 8, GRIS, italica=True)]],
        colWidths=[W * 0.38],
    )
    bloque_empresa.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))

    bloque_fecha = Table(
        [[_p("FECHA DEL REPORTE:", 8, NAVY, negrita=True, alin=2)],
         [_p(f.strftime("%d/%m/%Y"), 13, NAVY, negrita=True, alin=2)]],
        colWidths=[W * 0.22],
    )
    bloque_fecha.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))

    encabezado = Table(
        [[banner, bloque_empresa, bloque_fecha]],
        colWidths=[W * 0.40, W * 0.38, W * 0.22],
    )
    encabezado.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ]))
    elementos.append(encabezado)
    elementos.append(Spacer(1, 4 * mm))

    # ============ TARJETAS + GRÁFICO ============
    ancho_tarjetas = W * 0.62
    ancho_tarjeta = ancho_tarjetas / 4 - 5
    tarjetas = Table(
        [[
            _tarjeta(ancho_tarjeta, "TOTAL MOVIMIENTOS", str(len(movimientos)), "Transacciones", NAVY, "#"),
            _tarjeta(ancho_tarjeta, "VENTAS TOTALES", _fmt(total_ventas), "USD", VERDE, "+"),
            _tarjeta(ancho_tarjeta, "GASTOS TOTALES", _fmt(total_gastos), "USD", ROJO, "-"),
            _tarjeta(ancho_tarjeta, "TOTAL GENERAL", _fmt(neto_total), "USD", MORADO, "$"),
        ]],
        colWidths=[ancho_tarjetas / 4] * 4,
    )
    tarjetas.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    ancho_grafico = W * 0.38 - 6
    caja_grafico = Table(
        [[_p("EVOLUCIÓN POR MÉTODO DE PAGO - ÚLTIMOS 7 DÍAS (USD)", 7.5, NAVY, negrita=True)],
         [_grafico_evolucion(ancho_grafico - 12, 78, f)]],
        colWidths=[ancho_grafico],
    )
    caja_grafico.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("TOPPADDING", (0, 0), (0, 0), 6),
        ("BOTTOMPADDING", (0, -1), (0, -1), 4),
    ]))

    fila_media = Table([[tarjetas, caja_grafico]], colWidths=[W * 0.62, W * 0.38])
    fila_media.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    elementos.append(fila_media)
    elementos.append(Spacer(1, 4 * mm))

    # ============ TABLA DE DETALLE ============
    banda = Table([[_p("DETALLE DE MOVIMIENTOS", 9, colors.white, negrita=True, alin=1)]],
                  colWidths=[W])
    banda.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elementos.append(banda)

    cabeceras = ["#", "Cliente / Proveedor", "Tipo", "Movimiento", "Producto", "Método",
                 "Cantidad", "Precio Unit", "Descuento", "SubTotal", "Impuesto", "Total"]
    datos = [cabeceras]
    estilos_filas = []
    for idx, m in enumerate(movimientos, start=1):
        es_gasto = m.tipo == "Gasto"
        datos.append([
            str(m.numero), m.persona.nombre, m.persona.tipo, m.tipo, m.producto.nombre,
            m.metodo, str(m.cantidad),
            _fmt(m.precio_unitario, es_gasto), _fmt(m.descuento),
            _fmt(m.subtotal, es_gasto), _fmt(0), _fmt(m.total, es_gasto),
        ])
        if es_gasto:
            for col in (7, 9, 11):
                estilos_filas.append(("TEXTCOLOR", (col, idx), (col, idx), ROJO))

    datos.append(["TOTALES", "", "", "", "", "", str(total_cantidad), "", "",
                  _fmt(neto_subtotal, neto_subtotal < 0), _fmt(0),
                  _fmt(neto_total, neto_total < 0)])

    anchos = [0.03, 0.14, 0.07, 0.08, 0.15, 0.08, 0.06, 0.08, 0.08, 0.09, 0.06, 0.08]
    tabla = Table(datos, colWidths=[W * a for a in anchos], repeatRows=1)
    fila_total = len(datos) - 1
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), F_NORMAL),
        ("FONTNAME", (0, 0), (-1, 0), F_NEGRITA),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDE),
        ("ROWBACKGROUNDS", (0, 1), (-1, fila_total - 1), [colors.white, ZEBRA]),
        ("ALIGN", (6, 1), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Filas bien compactas: el máximo de movimientos por página
        ("TOPPADDING", (0, 0), (-1, -1), 1.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, fila_total), (-1, fila_total), NAVY),
        ("TEXTCOLOR", (0, fila_total), (-1, fila_total), colors.white),
        ("FONTNAME", (0, fila_total), (-1, fila_total), F_NEGRITA),
        # "TOTALES" ocupa las primeras columnas, alineado a la izquierda
        ("SPAN", (0, fila_total), (5, fila_total)),
        ("ALIGN", (0, fila_total), (0, fila_total), "LEFT"),
        *estilos_filas,
    ]))
    elementos.append(tabla)
    elementos.append(Spacer(1, 4 * mm))

    # ============ DISTRIBUCIÓN + OBSERVACIONES ============
    # El % es la proporción del MOVIMIENTO total (valores absolutos), igual que
    # las porciones de la dona: así leyenda y gráfico siempre coinciden y suman 100%.
    movido_total = sum(abs(v) for v in neto_por_metodo.values())
    filas_leyenda = []
    for m in METODOS:
        v = neto_por_metodo[m]
        pct = (abs(float(v)) / float(movido_total) * 100) if movido_total else 0
        cuadro = Drawing(8, 8)
        cuadro.add(Rect(0, 0, 8, 8, fillColor=COLOR_METODO[m], strokeColor=None))
        filas_leyenda.append([
            cuadro, _p(m, 8),
            _p(_fmt(v), 8, ROJO if v < 0 else colors.black, alin=2),
            _p(f"{pct:.2f}%", 8, ROJO if v < 0 else NAVY, negrita=True, alin=2),
        ])
    filas_leyenda.append([
        "", _p("TOTAL", 8, negrita=True),
        _p(_fmt(neto_total, neto_total < 0), 8, negrita=True, alin=2),
        _p("100.00%" if movido_total else "0.00%", 8, NAVY, negrita=True, alin=2),
    ])
    leyenda = Table(filas_leyenda, colWidths=[14, 70, 62, 48])
    leyenda.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, BORDE),
    ]))

    ancho_dist = W * 0.48 - 6
    caja_dist = Table(
        [[_p("DISTRIBUCIÓN POR MÉTODO DE PAGO", 8.5, NAVY, negrita=True), ""],
         [_dona_metodos(neto_por_metodo), leyenda]],
        colWidths=[110, ancho_dist - 110],
    )
    caja_dist.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
    ]))

    ancho_obs = W * 0.52 - 6
    # Alturas calculadas para que esta caja mida IGUAL que la de distribución
    # (título ~21 + fila de la dona ~107 = ~128)
    filas_obs = [[_p("OBSERVACIONES", 8.5, NAVY, negrita=True)]] + [[""] for _ in range(5)]
    caja_obs = Table(filas_obs, colWidths=[ancho_obs], rowHeights=[18] + [22] * 5)
    estilo_obs = [
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("TOPPADDING", (0, 0), (0, 0), 6),
    ]
    for i in range(1, 6):  # líneas punteadas para escribir a mano
        estilo_obs.append(("LINEBELOW", (0, i), (0, i), 0.6, BORDE, None, (2, 2)))
    caja_obs.setStyle(TableStyle(estilo_obs))

    fila_inferior = Table([[caja_dist, caja_obs]], colWidths=[W * 0.48, W * 0.52])
    fila_inferior.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 6),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ]))
    elementos.append(fila_inferior)

    doc.build(elementos, canvasmaker=_CanvasNumerado)
    buffer.seek(0)

    respuesta = HttpResponse(buffer.read(), content_type="application/pdf")
    respuesta["Content-Disposition"] = f'inline; filename="Resumen_{fecha}.pdf"'
    return respuesta
