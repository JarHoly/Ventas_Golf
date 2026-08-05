"""
PDF "RESUMEN DE MOVIMIENTOS DEL DÍA" — versión dashboard.
Réplica del diseño de la empresa: banner de título, tarjetas de totales,
gráfico de evolución por método, tabla de detalle, dona de distribución,
observaciones y pie de página con numeración.
"""
import io
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
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

from xml.sax.saxutils import escape

from django.utils import timezone

from .models import Movimiento, CierreDia, ObservacionDia, Persona, Producto
from .informes import calcular_informe, validar_rango, solo_personal_negocio, MAX_DIAS_SERIE_DIARIA

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

# Las categorías las crea el usuario en el CRUD (no son un set fijo como los
# métodos de pago), así que se les asigna color de esta paleta por orden,
# ciclando si hay más categorías que colores.
PALETA_CATEGORIAS = [
    AZUL_CLARO, VERDE, MORADO, AZUL,
    colors.HexColor("#F2A93B"), colors.HexColor("#E85D9E"), GRIS,
]


def _fmt(valor, negativo=False):
    """1500 -> '1,500.00' · negativo (por bandera O por signo) -> '(1,500.00)'."""
    texto = f"{abs(valor):,.2f}"
    return f"({texto})" if (negativo or valor < 0) else texto


SIMBOLO_MONEDA = {"USD": "$", "CRC": "₡"}


def _fmt_moneda(valor, moneda, negativo=False):
    """Igual que _fmt pero con el símbolo de la moneda del movimiento."""
    return f"{SIMBOLO_MONEDA.get(moneda, '$')}{_fmt(valor, negativo)}"


def _sub_usd_crc(valor_crc, negativo=False):
    """Para la 2da línea de una tarjeta: 'USD' si no hubo movimientos en
    colones, o '+ ₡X CRC' si sí (nunca se convierte/mezcla con el USD)."""
    return f"+ {_fmt_moneda(valor_crc, 'CRC', negativo)}" if valor_crc else "USD"


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
    # Solo USD: sin tipo de cambio no se puede sumar colones en la misma línea.
    dias = [fecha_reporte - timedelta(days=i) for i in range(DIAS_GRAFICO - 1, -1, -1)]
    neto = {m: {dia: 0.0 for dia in dias} for m in METODOS}
    consulta = Movimiento.objects.filter(fecha__range=(dias[0], dias[-1]), moneda="USD")
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


def _dona_categorias(ventas_por_categoria):
    """Dona de ingresos por categoría (tamaño de porción = monto de ventas)."""
    d = Drawing(95, 95)
    datos = [(c, v) for c, v in ventas_por_categoria if v > 0]
    if not datos:
        d.add(String(47, 45, "Sin datos", fontName=F_NORMAL, fontSize=7, fillColor=GRIS,
                     textAnchor="middle"))
        return d
    dona = Pie()
    dona.x, dona.y = 10, 10
    dona.width = dona.height = 75
    dona.data = [float(v) for _, v in datos]
    dona.innerRadiusFraction = 0.45
    dona.slices.strokeColor = colors.white
    dona.slices.strokeWidth = 1
    for i in range(len(datos)):
        dona.slices[i].fillColor = PALETA_CATEGORIAS[i % len(PALETA_CATEGORIAS)]
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
    # NO se convierte entre monedas (no se lleva tipo de cambio): dólares y
    # colones se suman CADA UNO por su lado. El gráfico de evolución y la
    # dona de distribución por método son visualizaciones de UN solo total,
    # así que se calculan solo con los movimientos en USD (el detalle de
    # abajo sí muestra cada fila en colones si corresponde).
    total_cantidad = sum(m.cantidad for m in movimientos)

    def _suma(tipo, moneda):
        return sum(m.total for m in movimientos if m.tipo == tipo and m.moneda == moneda)

    total_ventas = _suma("Venta", "USD")
    total_gastos = _suma("Gasto", "USD")
    total_ventas_crc = _suma("Venta", "CRC")
    total_gastos_crc = _suma("Gasto", "CRC")
    neto_subtotal = sum(
        m.subtotal if m.tipo == "Venta" else -m.subtotal
        for m in movimientos if m.moneda == "USD"
    )
    neto_subtotal_crc = sum(
        m.subtotal if m.tipo == "Venta" else -m.subtotal
        for m in movimientos if m.moneda == "CRC"
    )
    neto_total = total_ventas - total_gastos
    neto_total_crc = total_ventas_crc - total_gastos_crc

    # Neto por método (ventas suman, gastos restan) — como el reporte de la
    # empresa. Solo USD: ver nota arriba.
    neto_por_metodo = {m: 0 for m in METODOS}
    for m in movimientos:
        if m.moneda != "USD":
            continue
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
    # Cuadrícula 2x2: las tarjetas llenan la misma altura que el gráfico
    # (sin espacio muerto debajo).
    ancho_tarjetas = W * 0.62
    ancho_tarjeta = ancho_tarjetas / 2 - 6
    tarjetas = Table(
        [
            [_tarjeta(ancho_tarjeta, "TOTAL MOVIMIENTOS", str(len(movimientos)), "Transacciones", NAVY, "#"),
             _tarjeta(ancho_tarjeta, "VENTAS TOTALES", _fmt(total_ventas), _sub_usd_crc(total_ventas_crc), VERDE, "+")],
            [_tarjeta(ancho_tarjeta, "GASTOS TOTALES", _fmt(total_gastos), _sub_usd_crc(total_gastos_crc), ROJO, "-"),
             _tarjeta(ancho_tarjeta, "TOTAL GENERAL", _fmt(neto_total, neto_total < 0),
                      _sub_usd_crc(neto_total_crc, neto_total_crc < 0), MORADO, "$")],
        ],
        colWidths=[ancho_tarjetas / 2] * 2,
    )
    tarjetas.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),  # separación entre las dos filas
        ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
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
    # OJO: la tabla se AGREGA de última (después de la dona/observaciones).
    # Así la página 1 siempre contiene el resumen completo y solo el detalle
    # fluye a más páginas — nadie puede "perder" la hoja de los gráficos.
    banda = Table([[_p("DETALLE DE MOVIMIENTOS", 9, colors.white, negrita=True, alin=1)]],
                  colWidths=[W])
    banda.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    cabeceras = ["#", "Cliente / Proveedor", "Tipo", "Movimiento", "Producto", "Método",
                 "Cantidad", "Precio Unit", "Descuento", "SubTotal", "Impuesto", "Total"]
    datos = [cabeceras]
    estilos_filas = []
    for idx, m in enumerate(movimientos, start=1):
        es_gasto = m.tipo == "Gasto"
        datos.append([
            str(m.numero), _p(escape(m.persona.nombre), 7.5, leading=8.5),
            m.persona.tipo, m.tipo, _p(escape(m.producto.nombre), 7.5, leading=8.5),
            m.metodo, str(m.cantidad),
            _fmt_moneda(m.precio_unitario, m.moneda, es_gasto), _fmt_moneda(m.descuento, m.moneda),
            _fmt_moneda(m.subtotal, m.moneda, es_gasto), _fmt(0),
            _fmt_moneda(m.total, m.moneda, es_gasto),
        ])
        if es_gasto:
            for col in (7, 9, 11):
                estilos_filas.append(("TEXTCOLOR", (col, idx), (col, idx), ROJO))

    def _celda_totales(usd_val, crc_val, negativo_usd, negativo_crc):
        """La fila TOTALES no convierte: si hubo movimientos en las dos
        monedas, muestra las dos líneas (USD y CRC) en la misma celda."""
        lineas = [_fmt_moneda(usd_val, "USD", negativo_usd)]
        if crc_val:
            lineas.append(_fmt_moneda(crc_val, "CRC", negativo_crc))
        return _p("<br/>".join(lineas), 7.5, colors.white, negrita=True, alin=2, leading=9)

    datos.append(["TOTALES", "", "", "", "", "", str(total_cantidad), "", "",
                  _celda_totales(neto_subtotal, neto_subtotal_crc, neto_subtotal < 0, neto_subtotal_crc < 0),
                  _fmt(0),
                  _celda_totales(neto_total, neto_total_crc, neto_total < 0, neto_total_crc < 0)])

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
    # Misma altura EXACTA que la caja de observaciones (18 + 5x24 = 138)
    caja_dist = Table(
        [[_p("DISTRIBUCIÓN POR MÉTODO DE PAGO (USD)", 8.5, NAVY, negrita=True), ""],
         [_dona_metodos(neto_por_metodo), leyenda]],
        colWidths=[110, ancho_dist - 110],
        rowHeights=[20, 118],
    )
    caja_dist.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
    ]))

    ancho_obs = W * 0.52 - 6
    # Observaciones guardadas del día (las escribe un admin desde el sistema).
    obs = ObservacionDia.objects.filter(fecha=fecha).select_related("actualizado_por").first()
    texto_obs = obs.texto.strip() if obs else ""

    if texto_obs:
        # Con texto: se imprime (escapado, con saltos de línea) + quién y cuándo.
        parrafo = _p(escape(texto_obs).replace("\n", "<br/>"), 8, leading=11.5)
        quien = obs.actualizado_por
        nombre = (quien.get_full_name() or quien.username) if quien else "Sin registrar"
        cuando = timezone.localtime(obs.actualizado_en).strftime("%d/%m/%Y %H:%M")
        sello = _p(f"Última edición: {nombre} · {cuando}", 6.5, GRIS, italica=True)
        # La caja debe medir LO MISMO que la de distribución (138pt) aunque la
        # nota sea corta: medimos cuánto ocupa el texto y el sello absorbe el
        # resto pegado al fondo. Si la nota es muy larga, la caja crece.
        alto_texto = parrafo.wrap(ancho_obs - 12, 600)[1] + 8
        alto_sello = max(16, 138 - 18 - alto_texto)
        caja_obs = Table(
            [[_p("OBSERVACIONES", 8.5, NAVY, negrita=True)], [parrafo], [sello]],
            colWidths=[ancho_obs],
            rowHeights=[18, alto_texto, alto_sello],
        )
        caja_obs.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
            ("ROUNDEDCORNERS", [5, 5, 5, 5]),
            ("TOPPADDING", (0, 0), (0, 0), 6),
            ("TOPPADDING", (0, 1), (0, 1), 4),
            ("VALIGN", (0, -1), (0, -1), "BOTTOM"),
            ("BOTTOMPADDING", (0, -1), (0, -1), 6),
        ]))
    else:
        # Sin texto: las líneas punteadas de siempre, por si escriben a mano.
        # Alturas calculadas para que esta caja mida IGUAL que la de distribución
        # (título ~21 + fila de la dona ~107 = ~128)
        filas_obs = [[_p("OBSERVACIONES", 8.5, NAVY, negrita=True)]] + [[""] for _ in range(5)]
        caja_obs = Table(filas_obs, colWidths=[ancho_obs], rowHeights=[18] + [24] * 5)
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

    # ============ RESUMEN DE PRODUCTOS ============
    # Mismo criterio que la dona: solo Ventas en USD (los gastos son de
    # proveedores, no tiene sentido mezclarlos con lo vendido al cliente).
    metodos_resumen = ["Tarjeta", "Efectivo", "Transferencia", "Sinpe"]
    resumen_productos_dict = {}
    for m in movimientos:
        if m.tipo != "Venta" or m.moneda != "USD":
            continue
        fila_prod = resumen_productos_dict.setdefault(
            m.producto.nombre, {"cantidad": 0, "metodos": {met: 0 for met in metodos_resumen}}
        )
        fila_prod["cantidad"] += m.cantidad
        fila_prod["metodos"][m.metodo] += m.total
    resumen_productos = sorted(
        (
            {"producto": p, **d, "total": sum(d["metodos"].values())}
            for p, d in resumen_productos_dict.items()
        ),
        key=lambda r: r["total"], reverse=True,
    )

    if resumen_productos:
        banda_prod = Table(
            [[_p("RESUMEN DE PRODUCTOS", 9, colors.white, negrita=True, alin=1)]], colWidths=[W]
        )
        banda_prod.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))

        def _celda_metodo(v):
            return _fmt(v) if v else "-"

        datos_prod = [["Producto", "Cantidad"] + metodos_resumen]
        for r in resumen_productos:
            datos_prod.append([
                _p(escape(r["producto"]), 7.5, leading=8.5), str(r["cantidad"]),
                *[_celda_metodo(r["metodos"][met]) for met in metodos_resumen],
            ])
        totales_metodo = {met: sum(r["metodos"][met] for r in resumen_productos) for met in metodos_resumen}
        datos_prod.append([
            "TOTAL", str(sum(r["cantidad"] for r in resumen_productos)),
            *[_celda_metodo(totales_metodo[met]) for met in metodos_resumen],
        ])

        fila_total_prod = len(datos_prod) - 1
        anchos_prod = [0.40, 0.12, 0.12, 0.12, 0.12, 0.12]
        tabla_prod = Table(datos_prod, colWidths=[W * a for a in anchos_prod], repeatRows=1)
        tabla_prod.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), F_NORMAL),
            ("FONTNAME", (0, 0), (-1, 0), F_NEGRITA),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("GRID", (0, 0), (-1, -1), 0.4, BORDE),
            ("ROWBACKGROUNDS", (0, 1), (-1, fila_total_prod - 1), [colors.white, ZEBRA]),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("BACKGROUND", (0, fila_total_prod), (-1, fila_total_prod), NAVY),
            ("TEXTCOLOR", (0, fila_total_prod), (-1, fila_total_prod), colors.white),
            ("FONTNAME", (0, fila_total_prod), (-1, fila_total_prod), F_NEGRITA),
        ]))

        elementos.append(Spacer(1, 4 * mm))
        elementos.append(banda_prod)
        elementos.append(tabla_prod)

    # La tabla de detalle va al final: fluye a las páginas que necesite
    # (su cabecera se repite en cada página gracias a repeatRows=1).
    elementos.append(Spacer(1, 4 * mm))
    elementos.append(banda)
    elementos.append(tabla)

    # Marcador de integridad: si falta la última hoja, se nota de inmediato.
    texto_pie = f"Fin del detalle · {len(movimientos)} movimientos · Total {_fmt_moneda(neto_total, 'USD', neto_total < 0)}"
    if neto_total_crc:
        texto_pie += f" · {_fmt_moneda(neto_total_crc, 'CRC', neto_total_crc < 0)}"
    elementos.append(Spacer(1, 3 * mm))
    elementos.append(_p(texto_pie, 7.5, GRIS, italica=True, alin=1))

    doc.build(elementos, canvasmaker=_CanvasNumerado)
    buffer.seek(0)

    respuesta = HttpResponse(buffer.read(), content_type="application/pdf")
    respuesta["Content-Disposition"] = f'inline; filename="Resumen_{fecha}.pdf"'
    return respuesta


# ======================================================================
# INFORME ADMINISTRATIVO (rango de fechas) — mismo lenguaje visual que
# el resumen del día: banner navy, tarjetas, gráfico, dona y pie numerado.
# ======================================================================

def _variacion(actual, anterior):
    """Texto de la comparativa de una tarjeta: '+12.3% vs período anterior'."""
    if anterior == 0:
        return "Sin datos del período anterior"
    pct = (actual - anterior) / abs(anterior) * 100
    signo = "+" if pct >= 0 else ""
    return f"{signo}{pct:.1f}% vs período anterior"


def _grafico_ventas_gastos(ancho, alto, puntos):
    """Líneas de Ventas (verde) y Gastos (rojo) a lo largo del período.
    Verde/rojo es un par difícil para daltonismo: por eso SIEMPRE va
    acompañado de la leyenda con nombre (el color nunca viaja solo)."""
    d = Drawing(ancho, alto)

    x = 6
    for nombre, color in (("Ventas", VERDE), ("Gastos", ROJO)):
        d.add(Rect(x, alto - 10, 7, 5, fillColor=color, strokeColor=None))
        d.add(String(x + 10, alto - 9.5, nombre, fontName=F_NORMAL, fontSize=6, fillColor=GRIS))
        x += 52

    lc = HorizontalLineChart()
    lc.x, lc.y = 30, 14
    lc.width, lc.height = ancho - 42, alto - 34
    lc.data = [
        tuple(p["ventas"] for p in puntos),
        tuple(p["gastos"] for p in puntos),
    ]
    lc.lines[0].strokeColor = VERDE
    lc.lines[1].strokeColor = ROJO
    lc.lines[0].strokeWidth = 1.6
    lc.lines[1].strokeWidth = 1.6
    # Si hay muchos puntos, mostramos 1 de cada k etiquetas para que no se encimen.
    paso = max(1, round(len(puntos) / 10))
    lc.categoryAxis.categoryNames = [
        p["etiqueta"] if i % paso == 0 else "" for i, p in enumerate(puntos)
    ]
    lc.categoryAxis.labels.fontSize = 5
    lc.categoryAxis.labels.fontName = F_NORMAL
    lc.categoryAxis.tickShift = 1
    lc.valueAxis.labels.fontSize = 5
    lc.valueAxis.labels.fontName = F_NORMAL
    d.add(lc)
    return d


@api_view(["GET"])
def pdf_informe(request):
    """GET /api/reportes/resumen/pdf/?desde=YYYY-MM-DD&hasta=YYYY-MM-DD"""
    error = solo_personal_negocio(request)
    if error:
        return error
    rango, error = validar_rango(request)
    if error:
        return error
    desde, hasta = rango
    informe = calcular_informe(desde, hasta)
    tot, ant = informe["totales"], informe["anterior"]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=8 * mm, rightMargin=8 * mm,
        topMargin=8 * mm, bottomMargin=14 * mm,
        title=f"Informe administrativo {informe['desde']} a {informe['hasta']}",
    )
    W = doc.width
    elementos = []

    # ============ ENCABEZADO ============
    titulo_textos = Table(
        [[_p("INFORME", 12, colors.white, negrita=True, leading=13)],
         [_p("ADMINISTRATIVO", 15, AZUL_CLARO, negrita=True, leading=16)]],
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
        colWidths=[W * 0.36],
    )
    bloque_empresa.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))

    bloque_periodo = Table(
        [[_p("PERÍODO DEL INFORME:", 8, NAVY, negrita=True, alin=2)],
         [_p(f"{desde.strftime('%d/%m/%Y')}  –  {hasta.strftime('%d/%m/%Y')}", 12, NAVY,
             negrita=True, alin=2)]],
        colWidths=[W * 0.24],
    )
    bloque_periodo.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))

    encabezado = Table(
        [[banner, bloque_empresa, bloque_periodo]],
        colWidths=[W * 0.40, W * 0.36, W * 0.24],
    )
    encabezado.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ]))
    elementos.append(encabezado)
    elementos.append(Spacer(1, 4 * mm))

    # ============ TARJETAS (con comparativa vs período anterior) ============
    # No se convierte entre monedas: si hubo movimientos en colones en el
    # período, se agrega esa cifra a la línea de abajo, junto a la variación.
    def _sub_con_crc(variacion_txt, valor_crc, negativo_crc=False):
        if not valor_crc:
            return variacion_txt
        return f"{variacion_txt} · + {_fmt_moneda(valor_crc, 'CRC', negativo_crc)}"

    ancho_tarjeta = W / 4 - 6
    fila_tarjetas = Table(
        [[
            _tarjeta(ancho_tarjeta, "VENTAS TOTALES", _fmt(tot["ventas"]),
                     _sub_con_crc(_variacion(tot["ventas"], ant["ventas"]), tot["ventas_crc"]), VERDE, "+"),
            _tarjeta(ancho_tarjeta, "GASTOS TOTALES", _fmt(tot["gastos"]),
                     _sub_con_crc(_variacion(tot["gastos"], ant["gastos"]), tot["gastos_crc"]), ROJO, "-"),
            _tarjeta(ancho_tarjeta, "RESULTADO NETO", _fmt(tot["neto"], tot["neto"] < 0),
                     _sub_con_crc(_variacion(tot["neto"], ant["neto"]), tot["neto_crc"], tot["neto_crc"] < 0),
                     ROJO if tot["neto"] < 0 else MORADO, "$"),
            _tarjeta(ancho_tarjeta, "MOVIMIENTOS", str(tot["movimientos"]),
                     _variacion(tot["movimientos"], ant["movimientos"]), NAVY, "#"),
        ]],
        colWidths=[W / 4] * 4,
    )
    fila_tarjetas.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-2, -1), 6),
        ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    elementos.append(fila_tarjetas)
    elementos.append(Spacer(1, 4 * mm))

    # ============ EVOLUCIÓN + DONA POR MÉTODO ============
    puntos = informe["serie"]["puntos"]
    etiqueta_serie = "POR DÍA" if informe["serie"]["agrupacion"] == "dia" else "POR MES"
    ancho_grafico = W * 0.60 - 6
    caja_grafico = Table(
        [[_p(f"EVOLUCIÓN DE VENTAS Y GASTOS {etiqueta_serie} (USD)", 8, NAVY, negrita=True)],
         [_grafico_ventas_gastos(ancho_grafico - 12, 132, puntos)]],
        colWidths=[ancho_grafico],
    )
    caja_grafico.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("TOPPADDING", (0, 0), (0, 0), 6),
        ("BOTTOMPADDING", (0, -1), (0, -1), 4),
    ]))

    neto_por_metodo = {m["metodo"]: m["neto"] for m in informe["por_metodo"]}
    movido_total = sum(abs(v) for v in neto_por_metodo.values())
    filas_leyenda = []
    for m in METODOS:
        v = neto_por_metodo[m]
        pct = (abs(v) / movido_total * 100) if movido_total else 0
        cuadro = Drawing(8, 8)
        cuadro.add(Rect(0, 0, 8, 8, fillColor=COLOR_METODO[m], strokeColor=None))
        filas_leyenda.append([
            cuadro, _p(m, 8),
            _p(_fmt(v), 8, ROJO if v < 0 else colors.black, alin=2),
            _p(f"{pct:.2f}%", 8, ROJO if v < 0 else NAVY, negrita=True, alin=2),
        ])
    filas_leyenda.append([
        "", _p("TOTAL", 8, negrita=True),
        _p(_fmt(tot["neto"], tot["neto"] < 0), 8, negrita=True, alin=2),
        _p("100.00%" if movido_total else "0.00%", 8, NAVY, negrita=True, alin=2),
    ])
    leyenda = Table(filas_leyenda, colWidths=[14, 70, 62, 48])
    leyenda.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, BORDE),
    ]))

    ancho_dist = W * 0.40 - 6
    caja_dist = Table(
        [[_p("DISTRIBUCIÓN POR MÉTODO DE PAGO (NETO, USD)", 8, NAVY, negrita=True), ""],
         [_dona_metodos(neto_por_metodo), leyenda]],
        colWidths=[105, ancho_dist - 105],
        rowHeights=[20, 128],
    )
    caja_dist.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
    ]))

    fila_media = Table([[caja_grafico, caja_dist]], colWidths=[W * 0.60, W * 0.40])
    fila_media.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 6),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ]))
    elementos.append(fila_media)
    elementos.append(Spacer(1, 4 * mm))

    # ============ TABLA POR CATEGORÍA ============
    banda = Table([[_p("RESULTADO POR CATEGORÍA", 9, colors.white, negrita=True, alin=1)]],
                  colWidths=[W])
    banda.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elementos.append(banda)

    # Las columnas en colones solo se muestran si de verdad hubo movimientos
    # en CRC en el período (si el negocio solo usa dólares, no hay que
    # ensuciarle la tabla con columnas en cero).
    hay_crc = informe["hay_crc"]
    cabeceras_cat = ["Categoría", "Cantidad", "Ventas ($)", "Gastos ($)", "Neto ($)"]
    if hay_crc:
        cabeceras_cat += ["Ventas (₡)", "Gastos (₡)", "Neto (₡)"]
    datos = [cabeceras_cat]
    estilos_filas = []
    for idx, c in enumerate(informe["por_categoria"], start=1):
        fila = [
            _p(escape(c["categoria"]), 8, leading=9.5), str(c["cantidad"]),
            _fmt(c["ventas"]), _fmt(c["gastos"], c["gastos"] > 0),
            _fmt(c["neto"], c["neto"] < 0),
        ]
        if c["gastos"] > 0:
            estilos_filas.append(("TEXTCOLOR", (3, idx), (3, idx), ROJO))
        if c["neto"] < 0:
            estilos_filas.append(("TEXTCOLOR", (4, idx), (4, idx), ROJO))
        if hay_crc:
            fila += [
                _fmt(c["ventas_crc"]), _fmt(c["gastos_crc"], c["gastos_crc"] > 0),
                _fmt(c["neto_crc"], c["neto_crc"] < 0),
            ]
            if c["gastos_crc"] > 0:
                estilos_filas.append(("TEXTCOLOR", (6, idx), (6, idx), ROJO))
            if c["neto_crc"] < 0:
                estilos_filas.append(("TEXTCOLOR", (7, idx), (7, idx), ROJO))
        datos.append(fila)
    if not informe["por_categoria"]:
        datos.append(["Sin movimientos en el período"] + [""] * (len(cabeceras_cat) - 1))
    fila_totales = ["TOTALES", str(tot["cantidad"]), _fmt(tot["ventas"]),
                    _fmt(tot["gastos"], tot["gastos"] > 0),
                    _fmt(tot["neto"], tot["neto"] < 0)]
    if hay_crc:
        fila_totales += [_fmt(tot["ventas_crc"]), _fmt(tot["gastos_crc"], tot["gastos_crc"] > 0),
                          _fmt(tot["neto_crc"], tot["neto_crc"] < 0)]
    datos.append(fila_totales)

    fila_total = len(datos) - 1
    anchos_cat = (0.22, 0.09, 0.11, 0.11, 0.10, 0.12, 0.12, 0.13) if hay_crc else (0.36, 0.14, 0.17, 0.17, 0.16)
    tabla = Table(datos, colWidths=[W * a for a in anchos_cat], repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), F_NORMAL),
        ("FONTNAME", (0, 0), (-1, 0), F_NEGRITA),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDE),
        ("ROWBACKGROUNDS", (0, 1), (-1, fila_total - 1), [colors.white, ZEBRA]),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("BACKGROUND", (0, fila_total), (-1, fila_total), NAVY),
        ("TEXTCOLOR", (0, fila_total), (-1, fila_total), colors.white),
        ("FONTNAME", (0, fila_total), (-1, fila_total), F_NEGRITA),
        *estilos_filas,
    ]))
    elementos.append(tabla)

    texto_pie_informe = (
        f"Informe del {desde.strftime('%d/%m/%Y')} al {hasta.strftime('%d/%m/%Y')} · "
        f"{tot['movimientos']} movimientos · Neto {_fmt_moneda(tot['neto'], 'USD', tot['neto'] < 0)}"
    )
    if hay_crc:
        texto_pie_informe += f" · {_fmt_moneda(tot['neto_crc'], 'CRC', tot['neto_crc'] < 0)}"
    elementos.append(Spacer(1, 3 * mm))
    elementos.append(_p(texto_pie_informe, 7.5, GRIS, italica=True, alin=1))

    doc.build(elementos, canvasmaker=_CanvasNumerado)
    buffer.seek(0)

    respuesta = HttpResponse(buffer.read(), content_type="application/pdf")
    respuesta["Content-Disposition"] = (
        f'inline; filename="Informe_{informe["desde"]}_{informe["hasta"]}.pdf"'
    )
    return respuesta


# ======================================================================
# DETALLE DE MOVIMIENTOS POR RANGO DE FECHAS (con los mismos filtros que la
# pantalla de Movimientos). A diferencia del resumen diario, NO exige que
# los días estén cerrados: es un reporte de consulta/exportación, no el
# cierre oficial del día.
# ======================================================================

def _decimal_o_none(texto):
    if not texto:
        return None
    try:
        return Decimal(texto)
    except InvalidOperation:
        return None


def _movimientos_filtrados(request):
    """Aplica a la queryset los mismos filtros del panel de Movimientos:
    persona, producto, método, categoría y monto (mín/máx, en la moneda
    propia de cada movimiento — no se convierte)."""
    qp = request.query_params
    qs = (
        Movimiento.objects.filter(fecha__range=(qp.get("desde"), qp.get("hasta")))
        .select_related("persona", "producto", "producto__categoria")
        .order_by("fecha", "numero")
    )
    if qp.get("persona"):
        qs = qs.filter(persona_id=qp["persona"])
    if qp.get("producto"):
        qs = qs.filter(producto_id=qp["producto"])
    if qp.get("metodo"):
        qs = qs.filter(metodo=qp["metodo"])
    if qp.get("categoria"):
        qs = qs.filter(producto__categoria_id=qp["categoria"])

    monto_min = _decimal_o_none(qp.get("monto_min"))
    monto_max = _decimal_o_none(qp.get("monto_max"))
    movimientos = list(qs)
    if monto_min is not None:
        movimientos = [m for m in movimientos if m.total >= monto_min]
    if monto_max is not None:
        movimientos = [m for m in movimientos if m.total <= monto_max]
    return movimientos


def _serie_desde_movimientos(movimientos, desde, hasta):
    """Igual que informes._serie_evolucion, pero a partir de una lista de
    movimientos YA FILTRADA en Python (los filtros del panel no son solo de
    fecha, así que no se puede volver a consultar la BD desde cero).
    Solo USD, por la misma razón que en el resto del reporte: un gráfico de
    línea no puede mostrar dos monedas sin sumarlas, y no se convierte."""
    por_dia = (hasta - desde).days + 1 <= MAX_DIAS_SERIE_DIARIA
    agregados = {}
    for m in movimientos:
        if m.moneda != "USD":
            continue
        clave = m.fecha if por_dia else date(m.fecha.year, m.fecha.month, 1)
        fila = agregados.setdefault(clave, {"ventas": 0.0, "gastos": 0.0})
        monto = float(m.total)
        fila["ventas" if m.tipo == "Venta" else "gastos"] += monto

    puntos = []
    if por_dia:
        dia = desde
        while dia <= hasta:
            fila = agregados.get(dia, {"ventas": 0.0, "gastos": 0.0})
            puntos.append({"etiqueta": dia.strftime("%d/%m"), **fila})
            dia += timedelta(days=1)
    else:
        mes = date(desde.year, desde.month, 1)
        while mes <= hasta:
            fila = agregados.get(mes, {"ventas": 0.0, "gastos": 0.0})
            puntos.append({"etiqueta": mes.strftime("%m/%Y"), **fila})
            mes = date(mes.year + mes.month // 12, mes.month % 12 + 1, 1)
    return puntos, ("dia" if por_dia else "mes")


@api_view(["GET"])
def pdf_rango_movimientos(request):
    """GET /api/reportes/rango/pdf/?desde=&hasta=&persona=&producto=&metodo=&categoria=&monto_min=&monto_max=
    PDF de movimientos para un rango de fechas con filtros — mismo diseño
    dashboard que el resumen diario (tarjetas, gráfico, dona) más el
    detalle, pero sin exigir que los días estén cerrados."""
    rango, error = validar_rango(request)
    if error:
        return error
    desde, hasta = rango
    movimientos = _movimientos_filtrados(request)

    total_cantidad = sum(m.cantidad for m in movimientos)

    def _suma(tipo, moneda):
        return sum(m.total for m in movimientos if m.tipo == tipo and m.moneda == moneda)

    ventas_usd, gastos_usd = _suma("Venta", "USD"), _suma("Gasto", "USD")
    ventas_crc, gastos_crc = _suma("Venta", "CRC"), _suma("Gasto", "CRC")
    neto_usd = ventas_usd - gastos_usd
    neto_crc = ventas_crc - gastos_crc

    # Neto por método (solo USD, igual que en el resumen diario y el informe).
    neto_por_metodo = {m: 0 for m in METODOS}
    for mv in movimientos:
        if mv.moneda != "USD":
            continue
        neto_por_metodo[mv.metodo] += mv.total if mv.tipo == "Venta" else -mv.total

    # Ingresos por categoría (solo Ventas en USD, mismo criterio de las demás
    # gráficas de este PDF): cuánto vendió cada categoría, ordenado de mayor
    # a menor, para ver de un vistazo en qué se concentran los ingresos.
    ventas_por_categoria_dict = {}
    for mv in movimientos:
        if mv.tipo != "Venta" or mv.moneda != "USD":
            continue
        nombre_cat = mv.producto.categoria.nombre
        ventas_por_categoria_dict[nombre_cat] = ventas_por_categoria_dict.get(nombre_cat, 0) + mv.total
    ventas_por_categoria = sorted(
        ventas_por_categoria_dict.items(), key=lambda par: par[1], reverse=True
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=8 * mm, rightMargin=8 * mm,
        topMargin=8 * mm, bottomMargin=14 * mm,
        title=f"Movimientos {desde} a {hasta}",
    )
    W = doc.width
    elementos = []

    # ============ ENCABEZADO ============
    titulo_textos = Table(
        [[_p("DETALLE DE", 12, colors.white, negrita=True, leading=13)],
         [_p("MOVIMIENTOS (RANGO)", 15, AZUL_CLARO, negrita=True, leading=16)]],
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
         [_p("Cada movimiento se muestra en su propia moneda (no se convierte)", 8, GRIS, italica=True)]],
        colWidths=[W * 0.38],
    )
    bloque_empresa.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    bloque_periodo = Table(
        [[_p("PERÍODO:", 8, NAVY, negrita=True, alin=2)],
         [_p(f"{desde.strftime('%d/%m/%Y')} – {hasta.strftime('%d/%m/%Y')}", 13, NAVY,
             negrita=True, alin=2)]],
        colWidths=[W * 0.22],
    )
    bloque_periodo.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    encabezado = Table(
        [[banner, bloque_empresa, bloque_periodo]],
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
    ancho_tarjeta = ancho_tarjetas / 2 - 6
    tarjetas = Table(
        [
            [_tarjeta(ancho_tarjeta, "TOTAL MOVIMIENTOS", str(len(movimientos)), "Transacciones", NAVY, "#"),
             _tarjeta(ancho_tarjeta, "VENTAS TOTALES", _fmt(ventas_usd), _sub_usd_crc(ventas_crc), VERDE, "+")],
            [_tarjeta(ancho_tarjeta, "GASTOS TOTALES", _fmt(gastos_usd), _sub_usd_crc(gastos_crc), ROJO, "-"),
             _tarjeta(ancho_tarjeta, "TOTAL GENERAL", _fmt(neto_usd, neto_usd < 0),
                      _sub_usd_crc(neto_crc, neto_crc < 0), MORADO, "$")],
        ],
        colWidths=[ancho_tarjetas / 2] * 2,
    )
    tarjetas.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
    ]))

    puntos, agrupacion = _serie_desde_movimientos(movimientos, desde, hasta)
    etiqueta_serie = "POR DÍA" if agrupacion == "dia" else "POR MES"
    ancho_grafico = W * 0.38 - 6
    caja_grafico = Table(
        [[_p(f"EVOLUCIÓN DE VENTAS Y GASTOS {etiqueta_serie} (USD)", 7.5, NAVY, negrita=True)],
         [_grafico_ventas_gastos(ancho_grafico - 12, 78, puntos)]],
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

    # ============ DISTRIBUCIÓN POR MÉTODO + FILTROS APLICADOS ============
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
        _p(_fmt(neto_usd, neto_usd < 0), 8, negrita=True, alin=2),
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
        [[_p("DISTRIBUCIÓN POR MÉTODO DE PAGO (USD)", 8.5, NAVY, negrita=True), ""],
         [_dona_metodos(neto_por_metodo), leyenda]],
        colWidths=[110, ancho_dist - 110],
        rowHeights=[20, 118],
    )
    caja_dist.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
    ]))

    ancho_ingresos = W * 0.52 - 6
    ventas_totales_usd = sum(v for _, v in ventas_por_categoria)
    filas_leyenda_cat = []
    for i, (nombre_cat, v) in enumerate(ventas_por_categoria):
        pct = (float(v) / float(ventas_totales_usd) * 100) if ventas_totales_usd else 0
        cuadro = Drawing(8, 8)
        cuadro.add(Rect(0, 0, 8, 8, fillColor=PALETA_CATEGORIAS[i % len(PALETA_CATEGORIAS)], strokeColor=None))
        filas_leyenda_cat.append([
            cuadro, _p(escape(nombre_cat), 8, leading=10),
            _p(_fmt(v), 8, alin=2),
            _p(f"{pct:.2f}%", 8, NAVY, negrita=True, alin=2),
        ])
    if not ventas_por_categoria:
        filas_leyenda_cat.append(["", _p("Sin ventas en el período.", 8, GRIS, italica=True), "", ""])
    else:
        filas_leyenda_cat.append([
            "", _p("TOTAL", 8, negrita=True),
            _p(_fmt(ventas_totales_usd), 8, negrita=True, alin=2),
            _p("100.00%", 8, NAVY, negrita=True, alin=2),
        ])
    leyenda_cat = Table(filas_leyenda_cat, colWidths=[14, 90, 62, 48])
    leyenda_cat.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, BORDE),
    ]))
    # A diferencia del método de pago (siempre 4 filas fijas), las categorías
    # las crea el negocio libremente en el CRUD y pueden ser muchas — la caja
    # crece según haga falta para que TODAS quepan, sin recortar ninguna.
    alto_filas_cat = max(118, 16 * len(filas_leyenda_cat) + 10)
    caja_ingresos = Table(
        [[_p("INGRESOS POR CATEGORÍA (USD)", 8.5, NAVY, negrita=True), ""],
         [_dona_categorias(ventas_por_categoria), leyenda_cat]],
        colWidths=[110, ancho_ingresos - 110],
        rowHeights=[20, alto_filas_cat],
    )
    caja_ingresos.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDE),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 1), (-1, 1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 1), (-1, 1), 8),
    ]))

    fila_inferior = Table([[caja_dist, caja_ingresos]], colWidths=[W * 0.48, W * 0.52])
    fila_inferior.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 6),
        ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ]))
    elementos.append(fila_inferior)
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

    cabeceras = ["#", "Fecha", "Cliente / Proveedor", "Tipo", "Movimiento", "Producto",
                 "Método", "Cantidad", "Precio Unit", "Descuento", "SubTotal", "Total"]
    datos = [cabeceras]
    estilos_filas = []
    for idx, m in enumerate(movimientos, start=1):
        es_gasto = m.tipo == "Gasto"
        datos.append([
            str(m.numero), m.fecha.strftime("%d/%m/%Y"),
            _p(escape(m.persona.nombre), 7.5, leading=8.5),
            m.persona.tipo, m.tipo, _p(escape(m.producto.nombre), 7.5, leading=8.5),
            m.metodo, str(m.cantidad),
            _fmt_moneda(m.precio_unitario, m.moneda, es_gasto), _fmt_moneda(m.descuento, m.moneda),
            _fmt_moneda(m.subtotal, m.moneda, es_gasto), _fmt_moneda(m.total, m.moneda, es_gasto),
        ])
        if es_gasto:
            for col in (8, 10, 11):
                estilos_filas.append(("TEXTCOLOR", (col, idx), (col, idx), ROJO))

    def _celda_totales(usd_val, crc_val, negativo_usd, negativo_crc):
        lineas = [_fmt_moneda(usd_val, "USD", negativo_usd)]
        if crc_val:
            lineas.append(_fmt_moneda(crc_val, "CRC", negativo_crc))
        return _p("<br/>".join(lineas), 7.5, colors.white, negrita=True, alin=2, leading=9)

    if not movimientos:
        datos.append(["Ningún movimiento coincide con el rango y los filtros elegidos."] + [""] * 11)
    datos.append(["TOTALES", "", "", "", "", "", "", str(total_cantidad), "", "",
                  _celda_totales(neto_usd, neto_crc, neto_usd < 0, neto_crc < 0),
                  _celda_totales(neto_usd, neto_crc, neto_usd < 0, neto_crc < 0)])

    anchos = [0.03, 0.07, 0.135, 0.07, 0.08, 0.145, 0.08, 0.06, 0.075, 0.075, 0.085, 0.085]
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
        ("ALIGN", (7, 1), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 1), (1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, fila_total), (-1, fila_total), NAVY),
        ("TEXTCOLOR", (0, fila_total), (-1, fila_total), colors.white),
        ("FONTNAME", (0, fila_total), (-1, fila_total), F_NEGRITA),
        ("SPAN", (0, fila_total), (6, fila_total)),
        ("ALIGN", (0, fila_total), (0, fila_total), "LEFT"),
        *estilos_filas,
    ]))
    elementos.append(tabla)

    texto_pie = f"{len(movimientos)} movimientos · Total {_fmt_moneda(neto_usd, 'USD', neto_usd < 0)}"
    if neto_crc:
        texto_pie += f" · {_fmt_moneda(neto_crc, 'CRC', neto_crc < 0)}"
    elementos.append(Spacer(1, 3 * mm))
    elementos.append(_p(texto_pie, 7.5, GRIS, italica=True, alin=1))

    doc.build(elementos, canvasmaker=_CanvasNumerado)
    buffer.seek(0)
    respuesta = HttpResponse(buffer.read(), content_type="application/pdf")
    respuesta["Content-Disposition"] = f'inline; filename="Movimientos_{desde}_{hasta}.pdf"'
    return respuesta
