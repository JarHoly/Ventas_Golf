"""
INVENTARIO: existencias y rotación.

Igual que las membresías, acá NO se guarda ningún saldo: la existencia se
CALCULA cada vez desde los registros que ya hay. Si el operativo corrige una
venta o borra una compra, el inventario se acomoda solo — nunca queda un
contador desfasado que haya que "arreglar a mano".

    existencia = inventario inicial + ajustes + compras − ventas

De dónde sale cada pieza:
  - compras  -> Movimiento tipo GASTO del producto (así se registra comprarle
                mercadería a un proveedor; es el mismo flujo de siempre).
  - ventas   -> Movimiento tipo VENTA del producto.
  - ajustes  -> AjusteInventario: inventario inicial, mermas, sobrantes y
                diferencias de conteo físico (lo que no pasa por caja).

Solo entran los productos con controla_inventario=True: un servicio o una
clase no tienen existencias que contar.
"""
import math
from datetime import timedelta

from django.db.models import Q, Sum
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import AjusteInventario, Movimiento, Producto
from .informes import validar_rango, solo_personal_negocio

# Horizonte por defecto de la sugerencia de compra: "¿cuánto necesito para
# cubrir los próximos N días al ritmo que viene vendiendo?".
DIAS_OBJETIVO = 30


def _por_producto(queryset, **anotaciones):
    """{producto_id: {clave: entero}} — los None de Sum() se vuelven 0."""
    filas = queryset.values("producto").annotate(**anotaciones)
    return {
        fila["producto"]: {clave: (fila[clave] or 0) for clave in anotaciones}
        for fila in filas
    }


def _movimientos(desde=None, hasta=None):
    """Compras (gastos) y ventas por producto, en un rango o desde siempre."""
    qs = Movimiento.objects.filter(producto__controla_inventario=True)
    if desde is not None:
        qs = qs.filter(fecha__gte=desde)
    if hasta is not None:
        qs = qs.filter(fecha__lte=hasta)
    return _por_producto(
        qs,
        compras=Sum("cantidad", filter=Q(tipo=Movimiento.Tipo.GASTO)),
        ventas=Sum("cantidad", filter=Q(tipo=Movimiento.Tipo.VENTA)),
    )


def _ajustes(desde=None, hasta=None):
    """Entradas y salidas de ajuste por producto (el tipo da el signo)."""
    qs = AjusteInventario.objects.filter(producto__controla_inventario=True)
    if desde is not None:
        qs = qs.filter(fecha__gte=desde)
    if hasta is not None:
        qs = qs.filter(fecha__lte=hasta)
    # "Inicial" y "Entrada" suman; "Salida" resta. Se separan en dos sumas
    # para poder mostrar ambas columnas en el reporte.
    return _por_producto(
        qs,
        ajustes_entrada=Sum(
            "cantidad",
            filter=Q(tipo__in=[AjusteInventario.Tipo.INICIAL, AjusteInventario.Tipo.ENTRADA]),
        ),
        ajustes_salida=Sum("cantidad", filter=Q(tipo=AjusteInventario.Tipo.SALIDA)),
    )


def _saldo(movs, ajus, producto_id):
    """ajustes + compras − ventas para un producto, en los datos ya agregados."""
    m = movs.get(producto_id, {})
    a = ajus.get(producto_id, {})
    return (
        a.get("ajustes_entrada", 0)
        - a.get("ajustes_salida", 0)
        + m.get("compras", 0)
        - m.get("ventas", 0)
    )


def existencia_actual():
    """
    {producto_id: existencia} con TODO el historial (sin filtro de fechas).
    Es la foto de bodega de hoy; la usa la pantalla de ajustes para mostrar
    contra qué se está comparando el conteo físico.
    """
    movs = _movimientos()
    ajus = _ajustes()
    ids = Producto.objects.filter(controla_inventario=True).values_list("id", flat=True)
    return {pid: _saldo(movs, ajus, pid) for pid in ids}


def _division(numerador, denominador):
    """Divide cuidando el cero: devuelve None en vez de reventar o mentir."""
    if not denominador:
        return None
    return numerador / denominador


def calcular_existencias(desde, hasta, dias_objetivo=DIAS_OBJETIVO):
    """
    Arma el reporte de existencias y rotación del período. Lo usan el
    endpoint JSON y el PDF, para que pantalla y papel nunca discrepen.
    """
    dias_periodo = (hasta - desde).days + 1
    vispera = desde - timedelta(days=1)

    # Antes del período -> con qué existencia arrancó cada producto.
    antes_movs = _movimientos(hasta=vispera)
    antes_ajus = _ajustes(hasta=vispera)
    # Dentro del período -> el movimiento que hubo.
    movs = _movimientos(desde, hasta)
    ajus = _ajustes(desde, hasta)

    filas = []
    productos = (
        Producto.objects.filter(controla_inventario=True)
        .select_related("categoria")
        .order_by("nombre")
    )
    for producto in productos:
        inicial = _saldo(antes_movs, antes_ajus, producto.id)

        m = movs.get(producto.id, {})
        a = ajus.get(producto.id, {})
        compras = m.get("compras", 0)
        ventas = m.get("ventas", 0)
        ajustes_entrada = a.get("ajustes_entrada", 0)
        ajustes_salida = a.get("ajustes_salida", 0)

        entradas = compras + ajustes_entrada
        salidas = ventas + ajustes_salida
        existencia = inicial + entradas - salidas

        # Ritmo de venta del período (unidades por día).
        promedio_diario = ventas / dias_periodo

        # ROTACIÓN: cuántas veces se "dio vuelta" el inventario. Se mide
        # contra la existencia PROMEDIO (inicial y final), que es el criterio
        # contable: usar solo la final castiga a quien acaba de reponer.
        promedio_existencia = (inicial + existencia) / 2
        rotacion = _division(ventas, promedio_existencia)

        # COBERTURA: para cuántos días alcanza lo que queda, al ritmo actual.
        dias_cobertura = _division(existencia, promedio_diario)

        # SUGERENCIA: cuánto comprar para cubrir el horizonte elegido. Sin
        # ventas en el período no se sugiere nada: no hay ritmo del cual
        # deducirlo.
        #
        # OJO: acá NO va un "cada cuántos días reponer" aparte. Ese dato ES
        # dias_cobertura (si el stock alcanza 26 días, se repone cada 26
        # días): tenerlo en dos columnas solo hacía dudar de cuál leer.
        if promedio_diario > 0:
            objetivo = math.ceil(promedio_diario * dias_objetivo)
            sugerido_comprar = max(0, objetivo - existencia)
        else:
            sugerido_comprar = 0

        filas.append({
            "producto_id": producto.id,
            "producto": producto.nombre,
            "categoria": producto.categoria.nombre,
            "existencia_inicial": inicial,
            "compras": compras,
            "ajustes_entrada": ajustes_entrada,
            "entradas": entradas,
            "ventas": ventas,
            "ajustes_salida": ajustes_salida,
            # Neto con signo: la tabla muestra UNA columna de ajustes, porque
            # tener entradas y salidas de ajuste a la vez es excepcional y dos
            # columnas casi siempre vacías solo ensucian.
            "ajustes": ajustes_entrada - ajustes_salida,
            "salidas": salidas,
            "existencia": existencia,
            "promedio_diario": round(promedio_diario, 2),
            "rotacion": round(rotacion, 2) if rotacion is not None else None,
            "dias_cobertura": round(dias_cobertura, 1) if dias_cobertura is not None else None,
            "sugerido_comprar": sugerido_comprar,
            # Señal para pintar la fila: sin existencias, o alcanza para
            # menos de una semana al ritmo que viene vendiendo.
            "alerta": existencia <= 0 or (dias_cobertura is not None and dias_cobertura < 7),
        })

    # Lo que más se mueve primero: es lo que hay que mirar.
    filas.sort(key=lambda f: (-f["ventas"], f["producto"]))

    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "dias": dias_periodo,
        "dias_objetivo": dias_objetivo,
        "productos": filas,
        "totales": {
            "productos": len(filas),
            "existencia": sum(f["existencia"] for f in filas),
            "existencia_inicial": sum(f["existencia_inicial"] for f in filas),
            "entradas": sum(f["entradas"] for f in filas),
            "salidas": sum(f["salidas"] for f in filas),
            # Desglosados además de los agregados: la fila de TOTALES de la
            # tabla tiene una columna por cada uno y no deben mezclarse.
            "compras": sum(f["compras"] for f in filas),
            "ajustes_entrada": sum(f["ajustes_entrada"] for f in filas),
            "ajustes_salida": sum(f["ajustes_salida"] for f in filas),
            "ajustes": sum(f["ajustes"] for f in filas),
            "ventas": sum(f["ventas"] for f in filas),
            "sin_existencia": sum(1 for f in filas if f["existencia"] <= 0),
            "por_reponer": sum(1 for f in filas if f["sugerido_comprar"] > 0),
        },
    }


def leer_dias_objetivo(request):
    """?dias_objetivo=30 — el horizonte de la sugerencia de compra."""
    try:
        valor = int(request.query_params.get("dias_objetivo", DIAS_OBJETIVO))
    except (TypeError, ValueError):
        return DIAS_OBJETIVO
    # Entre una semana y un año: fuera de ahí la sugerencia no significa nada.
    return min(365, max(7, valor))


@api_view(["GET"])
def reporte_existencias(request):
    """GET /api/inventario/existencias/?desde=&hasta=&dias_objetivo=30"""
    error = solo_personal_negocio(request)
    if error:
        return error
    rango, error = validar_rango(request)
    if error:
        return error
    return Response(calcular_existencias(*rango, leer_dias_objetivo(request)))


@api_view(["GET"])
def existencias_productos(request):
    """
    GET /api/inventario/stock/ -> [{"producto": id, "existencia": n}]

    La foto de hoy, sin período: la usa el formulario de ajustes para
    mostrar cuánto cree el sistema que hay antes de registrar un conteo.
    """
    error = solo_personal_negocio(request)
    if error:
        return error
    return Response([
        {"producto": pid, "existencia": cantidad}
        for pid, cantidad in existencia_actual().items()
    ])
