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

3) CASOS ESPECIALES: un ADMINISTRADOR puede fijar el vencimiento a mano
   (con motivo, y queda auditado). Esa fecha MANDA sobre el cálculo y
   sobrevive a los recálculos: pasa a ser la base del período, así que una
   renovación posterior le suma sus días ENCIMA — el ajuste no se pierde.
"""
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Membresia, Movimiento, Persona, Producto
from .permisos import es_admin


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

    # Ajuste manual del administrador, si hay uno. Se lee ANTES de recalcular
    # porque es el único dato que NO sale de los movimientos, y tiene que
    # sobrevivir a este recálculo.
    actual = Membresia.objects.filter(persona=persona).first()
    manual = actual.vence_el_manual if actual else None
    # Día en que se fijó la fecha a mano: lo que vino DESPUÉS se acumula
    # sobre ella. (Si faltara el dato, el ajuste se aplica al final.)
    fijado_el = (
        timezone.localdate(actual.ajustada_en)
        if actual is not None and actual.ajustada_en is not None
        else None
    )
    manual_aplicado = False

    vence_el = None
    inicia_el = None
    producto = None
    usos_incluidos = 0

    for mov in movimientos:
        # El ajuste manual entra en la línea de tiempo: desde acá, la fecha
        # que manda es la que fijó el administrador, y esta renovación le
        # suma sus días encima (regla 3).
        if manual is not None and not manual_aplicado and fijado_el is not None and mov.fecha > fijado_el:
            vence_el = manual
            manual_aplicado = True
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
        # Ya no le queda ningún movimiento de membresía: no tiene. OJO: esto
        # también se lleva el ajuste manual — a propósito, porque un ajuste
        # es sobre una membresía que existe, no una membresía en sí misma.
        Membresia.objects.filter(persona=persona).delete()
        return None

    if manual is not None and not manual_aplicado:
        # No hubo renovaciones después del ajuste: rige la fecha manual tal cual.
        vence_el = manual

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
            **_ajuste_a_json(None),
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
        # Si un administrador tocó la fecha, el frontend lo muestra con el
        # motivo: una fecha que no cuadra con el cálculo tiene que ser
        # explicable sin entrar a la base de datos.
        **_ajuste_a_json(membresia),
    }


def _ajuste_a_json(membresia):
    """Datos del ajuste manual (o vacíos si la fecha es la calculada)."""
    if membresia is None or membresia.vence_el_manual is None:
        return {
            "ajuste_manual": False,
            "ajuste_motivo": "",
            "ajustada_por": None,
            "ajustada_en": None,
        }
    quien = membresia.ajustada_por
    return {
        "ajuste_manual": True,
        "ajuste_motivo": membresia.ajuste_motivo,
        "ajustada_por": (quien.get_full_name() or quien.username) if quien else None,
        "ajustada_en": membresia.ajustada_en,
    }


@api_view(["PUT", "DELETE"])
def ajustar_vencimiento(request, persona_id):
    """
    CASO ESPECIAL — vencimiento a mano. SOLO administradores.

      PUT    /api/personas/<id>/membresia/   {"vence_el": "YYYY-MM-DD", "motivo": "..."}
      DELETE /api/personas/<id>/membresia/   -> vuelve a la fecha calculada

    Requiere que la persona YA tenga membresía: se ajusta una membresía
    existente, no se inventa una (para eso hay que registrar la venta del
    producto de membresía, que es lo que deja el rastro contable).
    """
    if not es_admin(request.user):
        return Response(
            {"detail": "Solo un administrador puede cambiar la fecha de vencimiento."},
            status=status.HTTP_403_FORBIDDEN,
        )

    persona = Persona.objects.filter(id=persona_id).first()
    if persona is None:
        return Response({"detail": "Persona no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    membresia = Membresia.objects.filter(persona=persona).first()
    if membresia is None:
        return Response(
            {"detail": "Esta persona no tiene membresía. Primero registrá la venta "
                       "del producto de membresía en los movimientos del día."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.method == "DELETE":
        membresia.vence_el_manual = None
        membresia.ajuste_motivo = ""
        membresia.ajustada_en = None
        membresia.ajustada_por = None
        membresia.save()
        recalcular_membresia(persona)
        return Response(estado_membresia(persona, timezone.localdate()))

    try:
        nueva = date.fromisoformat(request.data.get("vence_el") or "")
    except ValueError:
        return Response(
            {"vence_el": "Indicá la nueva fecha de vencimiento (YYYY-MM-DD)."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    motivo = (request.data.get("motivo") or "").strip()
    if not motivo:
        return Response(
            {"motivo": "Escribí el motivo del cambio: queda registrado para auditoría."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    membresia.vence_el_manual = nueva
    membresia.ajuste_motivo = motivo
    membresia.ajustada_en = timezone.now()
    membresia.ajustada_por = request.user
    membresia.save()
    # El recálculo es el que aplica la fecha manual sobre la línea de tiempo
    # (y el que la deja como vence_el efectivo).
    recalcular_membresia(persona)
    return Response(estado_membresia(persona, timezone.localdate()))


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
