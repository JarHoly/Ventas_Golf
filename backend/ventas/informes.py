"""
INFORME ADMINISTRATIVO: agregados de un rango de fechas (ventas, gastos,
métodos de pago, categorías y comparativa contra el período anterior).

Todo el cálculo pesado se hace EN LA BASE DE DATOS con la ORM (Sum/Count):
el frontend recibe los números ya listos y solo los dibuja.
"""
import calendar
from datetime import date, timedelta

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum
from django.db.models.functions import TruncMonth
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Movimiento
from .permisos import es_admin

METODOS = ["Transferencia", "Efectivo", "Tarjeta", "Sinpe"]

# El "monto" de un movimiento (cantidad × precio − descuento) calculado por la
# base de datos. Es la misma fórmula del @property subtotal del modelo, pero
# expresada para que Sum() pueda agregarla sin traer las filas a Python.
MONTO = ExpressionWrapper(
    F("cantidad") * F("precio_unitario") - F("descuento"),
    output_field=DecimalField(max_digits=14, decimal_places=2),
)

# Con más de este número de días, la serie de evolución se agrupa por MES
# (un punto por día quedaría ilegible en un rango de, digamos, un año).
MAX_DIAS_SERIE_DIARIA = 62


def _f(valor):
    """Decimal|None -> float (los None de Sum() sin filas se vuelven 0)."""
    return float(valor or 0)


def _fin_de_mes(fecha):
    return date(fecha.year, fecha.month, calendar.monthrange(fecha.year, fecha.month)[1])


def _restar_meses(primero_de_mes, n):
    """Retrocede n meses desde un día 1 (ej: 2026-07-01 - 3 meses = 2026-04-01)."""
    total = primero_de_mes.year * 12 + (primero_de_mes.month - 1) - n
    return date(total // 12, total % 12 + 1, 1)


def periodo_anterior(desde, hasta):
    """
    Contra qué se compara el período elegido:
    - Si es de meses calendario COMPLETOS (ej: 1–31 de julio), el período
      anterior son los mismos meses previos (junio), no una ventana de días.
    - Si es un rango libre, la ventana del mismo largo que termina justo antes.
    """
    if desde.day == 1 and hasta == _fin_de_mes(hasta):
        n_meses = (hasta.year - desde.year) * 12 + (hasta.month - desde.month) + 1
        return _restar_meses(desde, n_meses), desde - timedelta(days=1)
    duracion = hasta - desde
    fin = desde - timedelta(days=1)
    return fin - duracion, fin


def _totales(desde, hasta):
    agg = (
        Movimiento.objects.filter(fecha__range=(desde, hasta))
        .annotate(monto=MONTO)
        .aggregate(
            ventas=Sum("monto", filter=Q(tipo="Venta")),
            gastos=Sum("monto", filter=Q(tipo="Gasto")),
            movimientos=Count("id"),
        )
    )
    ventas, gastos = _f(agg["ventas"]), _f(agg["gastos"])
    return {
        "ventas": ventas,
        "gastos": gastos,
        "neto": ventas - gastos,
        "movimientos": agg["movimientos"],
    }


def _serie_evolucion(desde, hasta):
    """Ventas y gastos por día (rangos cortos) o por mes (rangos largos),
    SIN huecos: los días/meses sin movimientos aparecen en cero para que
    el gráfico no 'salte' fechas."""
    qs = Movimiento.objects.filter(fecha__range=(desde, hasta)).annotate(monto=MONTO)
    por_dia = (hasta - desde).days + 1 <= MAX_DIAS_SERIE_DIARIA

    if por_dia:
        filas = qs.values("fecha").annotate(
            v=Sum("monto", filter=Q(tipo="Venta")),
            g=Sum("monto", filter=Q(tipo="Gasto")),
        )
        datos = {fila["fecha"]: fila for fila in filas}
        serie, dia = [], desde
        while dia <= hasta:
            fila = datos.get(dia, {})
            serie.append({
                "fecha": dia.isoformat(),
                "etiqueta": dia.strftime("%d/%m"),
                "ventas": _f(fila.get("v")),
                "gastos": _f(fila.get("g")),
            })
            dia += timedelta(days=1)
        return {"agrupacion": "dia", "puntos": serie}

    filas = qs.annotate(mes=TruncMonth("fecha")).values("mes").annotate(
        v=Sum("monto", filter=Q(tipo="Venta")),
        g=Sum("monto", filter=Q(tipo="Gasto")),
    )
    datos = {fila["mes"]: fila for fila in filas}
    serie, mes = [], date(desde.year, desde.month, 1)
    while mes <= hasta:
        fila = datos.get(mes, {})
        serie.append({
            "fecha": mes.isoformat(),
            "etiqueta": mes.strftime("%m/%Y"),
            "ventas": _f(fila.get("v")),
            "gastos": _f(fila.get("g")),
        })
        mes = _restar_meses(mes, -1)
    return {"agrupacion": "mes", "puntos": serie}


def _por_metodo(desde, hasta):
    filas = (
        Movimiento.objects.filter(fecha__range=(desde, hasta))
        .annotate(monto=MONTO)
        .values("metodo")
        .annotate(
            v=Sum("monto", filter=Q(tipo="Venta")),
            g=Sum("monto", filter=Q(tipo="Gasto")),
            n=Count("id"),
        )
    )
    datos = {fila["metodo"]: fila for fila in filas}
    resultado = []
    for metodo in METODOS:  # orden FIJO: los colores del gráfico no deben bailar
        fila = datos.get(metodo, {})
        ventas, gastos = _f(fila.get("v")), _f(fila.get("g"))
        resultado.append({
            "metodo": metodo,
            "ventas": ventas,
            "gastos": gastos,
            "neto": ventas - gastos,
            "movimientos": fila.get("n", 0),
        })
    return resultado


def _por_categoria(desde, hasta):
    filas = (
        Movimiento.objects.filter(fecha__range=(desde, hasta))
        .annotate(monto=MONTO)
        .values("producto__categoria__nombre")
        .annotate(
            v=Sum("monto", filter=Q(tipo="Venta")),
            g=Sum("monto", filter=Q(tipo="Gasto")),
            n=Count("id"),
        )
    )
    resultado = [
        {
            "categoria": fila["producto__categoria__nombre"],
            "ventas": _f(fila["v"]),
            "gastos": _f(fila["g"]),
            "neto": _f(fila["v"]) - _f(fila["g"]),
            "movimientos": fila["n"],
        }
        for fila in filas
    ]
    # Las categorías que más venden primero (y a igual venta, más gasto primero).
    resultado.sort(key=lambda c: (-c["ventas"], -c["gastos"]))
    return resultado


def calcular_informe(desde, hasta):
    """Arma el informe completo. Lo usan el endpoint JSON y el PDF."""
    ant_desde, ant_hasta = periodo_anterior(desde, hasta)
    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "totales": _totales(desde, hasta),
        "anterior": {
            "desde": ant_desde.isoformat(),
            "hasta": ant_hasta.isoformat(),
            **_totales(ant_desde, ant_hasta),
        },
        "serie": _serie_evolucion(desde, hasta),
        "por_metodo": _por_metodo(desde, hasta),
        "por_categoria": _por_categoria(desde, hasta),
    }


def validar_rango(request):
    """Lee ?desde= y ?hasta= y los valida. Devuelve (desde, hasta) o un error."""
    try:
        desde = date.fromisoformat(request.query_params.get("desde", ""))
        hasta = date.fromisoformat(request.query_params.get("hasta", ""))
    except ValueError:
        return None, Response(
            {"detail": "Parámetros requeridos: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if desde > hasta:
        return None, Response(
            {"detail": "La fecha 'desde' no puede ser mayor que 'hasta'."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return (desde, hasta), None


def solo_admin(request):
    """El informe es financiero: solo administradores."""
    if es_admin(request.user):
        return None
    return Response(
        {"detail": "Solo un administrador puede ver el informe."},
        status=status.HTTP_403_FORBIDDEN,
    )


@api_view(["GET"])
def informe_resumen(request):
    """GET /api/reportes/resumen/?desde=YYYY-MM-DD&hasta=YYYY-MM-DD"""
    error = solo_admin(request)
    if error:
        return error
    rango, error = validar_rango(request)
    if error:
        return error
    return Response(calcular_informe(*rango))
