"""
MEMBRESÍAS y USOS DE CARRITO.

Dos reglas de negocio que vive todo este módulo:

1) RENOVAR NO PIERDE DÍAS. Si una membresía vence el 31/08 y el cliente
   renueva el 29/08 (le faltaban 2 días), la nueva no vence el 29/08 + 365
   sino el 31/08 + 365 — o sea, los días que le sobraban se suman.

2) RENOVAR SÍ REINICIA LOS USOS. Cada período arranca con los usos que
   incluye el producto (50 por defecto), sin arrastrar los sobrantes.

Nada de esto se guarda como contador: la membresía se RECALCULA desde los
movimientos y los usos se CUENTAN desde los movimientos. Si el operativo
corrige o borra un movimiento, todo se acomoda solo.
"""
from datetime import date, timedelta

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Membresia, Movimiento, Persona, Producto


def recalcular_membresia(persona):
    """
    Reconstruye la membresía de una persona desde CERO, recorriendo todos
    sus movimientos de productos de membresía en orden cronológico. Es la
    única función que escribe en la tabla Membresia.

    Sirve para las tres cosas a la vez: crear la membresía al vender,
    corregirla al editar/borrar un movimiento, y armar el historial viejo
    la primera vez que se marca un producto como "Membresía".
    """
    movimientos = (
        Movimiento.objects.filter(
            persona=persona,
            tipo=Movimiento.Tipo.VENTA,
            producto__rol_especial=Producto.RolEspecial.MEMBRESIA,
        )
        .select_related("producto")
        .order_by("fecha", "numero")
    )

    vence_el = None
    inicia_el = None
    producto = None
    usos_incluidos = 0

    for mov in movimientos:
        # Comprar cantidad 2 de una membresía anual = 2 años.
        dias = mov.producto.dias_vigencia * mov.cantidad
        if vence_el is not None and vence_el >= mov.fecha:
            # Todavía vigente: los días que le sobraban se acumulan.
            vence_el = vence_el + timedelta(days=dias)
        else:
            # Vencida (o primera compra): arranca el conteo desde la compra.
            vence_el = mov.fecha + timedelta(days=dias)
        # Los usos se reinician en CADA renovación: por eso el período de
        # usos arranca en la fecha del movimiento, no en la primera compra.
        inicia_el = mov.fecha
        producto = mov.producto
        usos_incluidos = mov.producto.usos_carrito

    if producto is None:
        # Ya no le queda ningún movimiento de membresía: no tiene.
        Membresia.objects.filter(persona=persona).delete()
        return None

    membresia, _ = Membresia.objects.update_or_create(
        persona=persona,
        defaults={
            "producto": producto,
            "inicia_el": inicia_el,
            "vence_el": vence_el,
            "usos_incluidos": usos_incluidos,
        },
    )
    return membresia


def recalcular_por_producto(producto):
    """
    Recalcula la membresía de TODA persona que tenga movimientos de este
    producto. Se usa cuando el admin marca (o desmarca) un producto como
    membresía: en ese momento el historial ya registrado pasa a contar.
    """
    ids = (
        Movimiento.objects.filter(producto=producto)
        .values_list("persona_id", flat=True)
        .distinct()
    )
    for persona in Persona.objects.filter(id__in=list(ids)):
        recalcular_membresia(persona)


def estado_membresia(persona, fecha, excluir_movimiento_id=None):
    """
    Foto de la membresía de una persona para una fecha dada ('fecha' es un
    date): si está vigente, cuántos usos de carrito lleva y cuántos le
    quedan.

    'excluir_movimiento_id' saca un movimiento de la cuenta: al EDITAR un
    movimiento de carrito, ese movimiento ya está guardado y contaría doble
    contra la cantidad que el operativo está escribiendo en pantalla.
    """
    membresia = (
        Membresia.objects.filter(persona=persona).select_related("producto").first()
    )
    if membresia is None:
        return {
            "tiene_membresia": False,
            "vencida": False,
            "vence_el": None,
            "producto_nombre": None,
            "usos_incluidos": 0,
            "usos_consumidos": 0,
            "usos_restantes": 0,
            "excedido": False,
            "fecha_excedido": None,
        }

    movimientos = (
        Movimiento.objects.filter(
            persona=persona,
            tipo=Movimiento.Tipo.VENTA,
            producto__rol_especial=Producto.RolEspecial.CARRITO,
            fecha__gte=membresia.inicia_el,
            fecha__lte=membresia.vence_el,
        )
        .order_by("fecha", "numero")
    )
    if excluir_movimiento_id:
        movimientos = movimientos.exclude(pk=excluir_movimiento_id)

    # Se recorre en orden para saber en QUÉ FECHA se pasó del límite: no
    # basta el total, el operativo necesita el dato exacto para explicarle
    # al cliente desde cuándo está excedido.
    consumidos = 0
    fecha_excedido = None
    for mov in movimientos:
        consumidos += mov.cantidad
        if fecha_excedido is None and consumidos > membresia.usos_incluidos:
            fecha_excedido = mov.fecha

    return {
        "tiene_membresia": True,
        "vencida": membresia.vence_el < fecha,
        "vence_el": membresia.vence_el.isoformat(),
        "producto_nombre": membresia.producto.nombre,
        "usos_incluidos": membresia.usos_incluidos,
        "usos_consumidos": consumidos,
        "usos_restantes": max(0, membresia.usos_incluidos - consumidos),
        "excedido": fecha_excedido is not None,
        "fecha_excedido": fecha_excedido.isoformat() if fecha_excedido else None,
    }


@api_view(["GET"])
def estado_membresia_view(request):
    """
    GET /api/membresias/estado/?persona=<id>&fecha=<YYYY-MM-DD>&excluir=<mov_id>

    Lo consulta el modal de movimientos cuando se elige un producto de
    carrito, para avisarle al operativo cuántos usos le quedan al cliente.
    """
    persona_id = request.query_params.get("persona")
    fecha_texto = request.query_params.get("fecha")
    if not persona_id or not fecha_texto:
        return Response(
            {"detail": "Faltan los parámetros 'persona' y 'fecha'."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        fecha = date.fromisoformat(fecha_texto)
    except ValueError:
        return Response(
            {"detail": "La fecha debe tener el formato YYYY-MM-DD."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    persona = Persona.objects.filter(id=persona_id).first()
    if persona is None:
        return Response({"detail": "Persona no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    return Response(
        estado_membresia(persona, fecha, request.query_params.get("excluir"))
    )
