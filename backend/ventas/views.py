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

from .models import Persona, Categoria, Producto, Movimiento, CierreDia
from .serializers import (
    PersonaSerializer,
    CategoriaSerializer,
    ProductoSerializer,
    MovimientoSerializer,
)


def _verificar_dia_abierto(fecha):
    """Lanza un error 400 si el día ya fue cerrado con TERMINAR EL DÍA."""
    if CierreDia.objects.filter(fecha=fecha).exists():
        raise ValidationError({"detail": f"El día {fecha} está cerrado. No se puede modificar."})


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
        qs = Persona.objects.all()
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


class MovimientoViewSet(viewsets.ModelViewSet):
    """
    CRUD de movimientos. Se usa siempre filtrado por día:
      GET /api/movimientos/?fecha=2026-07-17
    Reglas:
      - Si el día está cerrado (TERMINAR EL DÍA), no se puede crear/editar/borrar.
      - Al borrar, se recalculan los consecutivos del día (1, 2, 3...).
    """
    serializer_class = MovimientoSerializer

    def get_queryset(self):
        qs = Movimiento.objects.select_related("persona", "producto").all()
        fecha = self.request.query_params.get("fecha")
        if fecha:
            # El día se lista en orden de registro: #1, #2, #3...
            qs = qs.filter(fecha=fecha).order_by("numero")
        return qs

    def perform_create(self, serializer):
        _verificar_dia_abierto(serializer.validated_data["fecha"])
        # Guardamos quién lo registró (auditoría del login).
        serializer.save(registrado_por=self.request.user)

    def perform_update(self, serializer):
        _verificar_dia_abierto(serializer.instance.fecha)
        serializer.save()

    def perform_destroy(self, instance):
        _verificar_dia_abierto(instance.fecha)
        fecha = instance.fecha
        # transaction.atomic = "todo o nada": si algo falla a mitad de la
        # renumeración, la base vuelve al estado anterior (sin números salteados).
        with transaction.atomic():
            instance.delete()
            # Renumerar: los que quedan pasan a ser 1, 2, 3... sin huecos.
            restantes = Movimiento.objects.filter(fecha=fecha).order_by("numero")
            for i, mov in enumerate(restantes, start=1):
                if mov.numero != i:
                    Movimiento.objects.filter(pk=mov.pk).update(numero=i)


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

    # DELETE: reabrir. Solo usuarios administradores (is_staff).
    if not request.user.is_staff:
        return Response(
            {"detail": "Solo un administrador puede reabrir un día."},
            status=status.HTTP_403_FORBIDDEN,
        )
    CierreDia.objects.filter(fecha=fecha).delete()
    return Response({"cerrado": False})


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
