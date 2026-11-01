import json
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework import status

from .membresias import recalcular_membresia, recalcular_por_producto
from .models import (
    AjusteInventario,
    Persona,
    Categoria,
    Producto,
    Movimiento,
    CierreDia,
    ObservacionDia,
)
from .permisos import es_admin
from .serializers import (
    AjusteInventarioSerializer,
    PersonaSerializer,
    CategoriaSerializer,
    ProductoSerializer,
    MovimientoSerializer,
)


def _verificar_dia_abierto(fecha):
    """Lanza un error 400 si el día ya fue cerrado con TERMINAR EL DÍA."""
    if CierreDia.objects.filter(fecha=fecha).exists():
        raise ValidationError({"detail": f"El día {fecha} está cerrado. No se puede modificar."})


def _recalcular_membresias_afectadas(movimientos, previos=()):
    """
    Rehace la membresía de las personas tocadas por un movimiento de
    membresía. 'previos' son pares (persona, producto) de ANTES del cambio
    (al editar o borrar), porque si el movimiento dejó de ser de membresía
    —o cambió de dueño— igual hay que rehacer la del dueño anterior.

    Solo se recalcula si hay un producto de membresía involucrado: los
    movimientos de carrito no tocan esta tabla (sus usos se cuentan al
    vuelo desde los movimientos).
    """
    personas = {}
    pares = [(m.persona, m.producto) for m in movimientos] + list(previos)
    for persona, producto in pares:
        if producto.rol_especial == Producto.RolEspecial.MEMBRESIA:
            personas[persona.pk] = persona
    for persona in personas.values():
        recalcular_membresia(persona)


class BorradoProtegidoMixin:
    """
    Nuestras FK usan on_delete=PROTECT: no se puede borrar algo que otros
    registros están usando. Sin esto, Django lanza un error 500 feo;
    con esto, devolvemos un mensaje claro que el frontend puede mostrar.
    """

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "No se puede eliminar: tiene registros asociados."},
                status=status.HTTP_400_BAD_REQUEST,
            )


class PersonaViewSet(BorradoProtegidoMixin, viewsets.ModelViewSet):
    """
    CRUD completo:
      GET    /api/personas/         -> listar (admite ?tipo=Cliente)
      POST   /api/personas/         -> crear
      GET    /api/personas/{id}/    -> ver uno
      PUT    /api/personas/{id}/    -> editar
      DELETE /api/personas/{id}/    -> borrar
    """
    serializer_class = PersonaSerializer

    def get_queryset(self):
        # select_related sobre la membresía (y su producto) evita una consulta
        # por fila: la tabla de clientes muestra el vencimiento de cada uno.
        qs = Persona.objects.select_related("membresia", "membresia__producto").all()
        tipo = self.request.query_params.get("tipo")
        if tipo:
            qs = qs.filter(tipo=tipo)
        return qs


class CategoriaViewSet(BorradoProtegidoMixin, viewsets.ModelViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer


class ProductoViewSet(BorradoProtegidoMixin, viewsets.ModelViewSet):
    # select_related trae la categoría en la misma consulta (evita 1 query extra por fila).
    queryset = Producto.objects.select_related("categoria").all()
    serializer_class = ProductoSerializer

    def perform_update(self, serializer):
        """
        Al cambiar la configuración de membresía de un producto hay que
        rehacer las membresías: marcar "Membresía ULTIMATE" como membresía
        debe hacer que las ventas YA registradas de ese producto cuenten
        (es la forma de que el historial viejo entre al sistema), y
        desmarcarlo debe deshacerlas.
        """
        antes = (
            serializer.instance.rol_especial,
            serializer.instance.dias_vigencia,
            serializer.instance.usos_carrito,
        )
        producto = serializer.save()
        despues = (producto.rol_especial, producto.dias_vigencia, producto.usos_carrito)
        if antes != despues:
            recalcular_por_producto(producto)


class AjusteInventarioViewSet(viewsets.ModelViewSet):
    """
    Entradas y salidas de inventario que NO son una compra ni una venta:
    inventario inicial, mermas, sobrantes y diferencias de conteo físico.
    Las compras y ventas ya ajustan la existencia por su cuenta — acá no se
    registran, se registran como movimientos del día.

      GET /api/ajustes-inventario/                      -> últimos ajustes
      GET /api/ajustes-inventario/?producto=3           -> de un producto
      GET /api/ajustes-inventario/?desde=...&hasta=...  -> de un rango
    """
    serializer_class = AjusteInventarioSerializer

    def get_queryset(self):
        qs = AjusteInventario.objects.select_related("producto", "registrado_por").all()
        producto = self.request.query_params.get("producto")
        desde = self.request.query_params.get("desde")
        hasta = self.request.query_params.get("hasta")
        if producto:
            qs = qs.filter(producto=producto)
        if desde:
            qs = qs.filter(fecha__gte=desde)
        if hasta:
            qs = qs.filter(fecha__lte=hasta)
        return qs

    def perform_create(self, serializer):
        # Quién lo registró: un ajuste cambia las existencias sin que haya
        # plata de por medio, así que el rastro importa más que nunca.
        serializer.save(registrado_por=self.request.user)


class MovimientoViewSet(viewsets.ModelViewSet):
    """
    CRUD de movimientos. Se usa filtrado por día:
      GET /api/movimientos/?fecha=2026-07-17
    o por rango de fechas (para la vista de "Rango de fechas", solo lectura):
      GET /api/movimientos/?desde=2026-07-01&hasta=2026-07-17
    Reglas:
      - Si el día está cerrado (TERMINAR EL DÍA), no se puede crear/editar/borrar.
      - Al borrar, se recalculan los consecutivos del día (1, 2, 3...).
    """
    serializer_class = MovimientoSerializer

    def get_queryset(self):
        qs = Movimiento.objects.select_related("persona", "producto").all()
        fecha = self.request.query_params.get("fecha")
        desde = self.request.query_params.get("desde")
        hasta = self.request.query_params.get("hasta")
        if fecha:
            # El día se lista en orden de registro: #1, #2, #3...
            qs = qs.filter(fecha=fecha).order_by("numero")
        elif desde and hasta:
            qs = qs.filter(fecha__range=(desde, hasta)).order_by("-fecha", "-numero")
        return qs

    def perform_create(self, serializer):
        _verificar_dia_abierto(serializer.validated_data["fecha"])
        # Guardamos quién lo registró (auditoría del login).
        movimiento = serializer.save(registrado_por=self.request.user)
        _recalcular_membresias_afectadas([movimiento])

    def perform_update(self, serializer):
        _verificar_dia_abierto(serializer.instance.fecha)
        # Se guarda el "antes" porque al editar puede cambiar la persona o el
        # producto: en ese caso hay dos membresías que rehacer, la del dueño
        # viejo del movimiento y la del nuevo.
        anterior = (serializer.instance.persona, serializer.instance.producto)
        movimiento = serializer.save()
        _recalcular_membresias_afectadas([movimiento], previos=[anterior])

    def perform_destroy(self, instance):
        _verificar_dia_abierto(instance.fecha)
        fecha = instance.fecha
        borrado = (instance.persona, instance.producto)
        # transaction.atomic = "todo o nada": si algo falla a mitad de la
        # renumeración, la base vuelve al estado anterior (sin números salteados).
        with transaction.atomic():
            instance.delete()
            # Renumerar: los que quedan pasan a ser 1, 2, 3... sin huecos.
            restantes = Movimiento.objects.filter(fecha=fecha).order_by("numero")
            for i, mov in enumerate(restantes, start=1):
                if mov.numero != i:
                    Movimiento.objects.filter(pk=mov.pk).update(numero=i)
            _recalcular_membresias_afectadas([], previos=[borrado])


@api_view(["GET", "POST", "DELETE"])
def estado_dia(request, fecha):
    """
    Estado y cierre de un día:
      GET    -> {"cerrado": true/false}
      POST   -> TERMINAR EL DÍA (lo cierra)
      DELETE -> reabrir el día (solo administradores)
    """
    if request.method == "GET":
        return Response({"cerrado": CierreDia.objects.filter(fecha=fecha).exists()})

    if request.method == "POST":
        if not Movimiento.objects.filter(fecha=fecha).exists():
            return Response(
                {"detail": "No se puede terminar un día sin movimientos."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        CierreDia.objects.get_or_create(fecha=fecha, defaults={"cerrado_por": request.user})
        return Response({"cerrado": True})

    # DELETE: reabrir. Solo usuarios administradores.
    if not es_admin(request.user):
        return Response(
            {"detail": "Solo un administrador puede reabrir un día."},
            status=status.HTTP_403_FORBIDDEN,
        )
    CierreDia.objects.filter(fecha=fecha).delete()
    return Response({"cerrado": False})


def _obs_a_json(obs):
    """ObservacionDia -> dict para el frontend (o vacío si no existe)."""
    if obs is None:
        return {"texto": "", "actualizado_en": None, "actualizado_por": None}
    quien = obs.actualizado_por
    return {
        "texto": obs.texto,
        "actualizado_en": obs.actualizado_en,
        "actualizado_por": (quien.get_full_name() or quien.username) if quien else None,
    }


@api_view(["GET", "PUT"])
def observacion_dia(request, fecha):
    """
    Observaciones del día (se imprimen en el PDF):
      GET -> las lee cualquier usuario logueado
      PUT -> {"texto": "..."} las guarda; SOLO administradores.
    OJO: se pueden editar aunque el día esté cerrado — ese es justo el caso
    de uso: agregar una nota después del cierre y regenerar el PDF.
    """
    if request.method == "GET":
        obs = (
            ObservacionDia.objects.filter(fecha=fecha)
            .select_related("actualizado_por")
            .first()
        )
        return Response(_obs_a_json(obs))

    if not es_admin(request.user):
        return Response(
            {"detail": "Solo un administrador puede editar las observaciones."},
            status=status.HTTP_403_FORBIDDEN,
        )
    texto = (request.data.get("texto") or "").strip()
    obs, _ = ObservacionDia.objects.update_or_create(
        fecha=fecha,
        defaults={"texto": texto, "actualizado_por": request.user},
    )
    return Response(_obs_a_json(obs))


@api_view(["GET"])
def buscar_cedula(request, cedula):
    """
    Proxy al padrón: GET /api/cedula/{cedula}/  -> {"cedula", "nombre"}.
    Lo hacemos desde el backend (no desde el navegador) para evitar CORS
    y no exponer el servicio externo directamente al cliente.
    """
    url = f"https://apis.gometa.org/cedulas/{cedula}"
    try:
        peticion = Request(url, headers={"User-Agent": "Ecuestas/1.0"})
        with urlopen(peticion, timeout=8) as resp:
            data = json.load(resp)
    except (URLError, HTTPError, TimeoutError, ValueError):
        return Response(
            {"detail": "No se pudo consultar el padrón. Escribí el nombre manualmente."},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    resultados = data.get("results") or []
    if not resultados:
        return Response(
            {"detail": "Cédula no encontrada."},
            status=status.HTTP_404_NOT_FOUND,
        )

    # El padrón devuelve el nombre en piezas. Lo armamos en orden natural:
    # nombre(s) + apellido1 + apellido2, y quitamos espacios sobrantes.
    r = resultados[0]
    partes = [r.get("firstname1"), r.get("firstname2"), r.get("lastname1"), r.get("lastname2")]
    nombre = " ".join(p for p in partes if p) or data.get("nombre", "")

    return Response({"cedula": cedula, "nombre": nombre})
