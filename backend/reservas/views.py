"""
API del portal de reservas.

Reglas de acceso (los permisos viven en ventas/permisos.py):
- Áreas: el cliente las LEE (solo activas), el personal las gestiona.
- Reservas: el cliente crea/edita/borra LAS SUYAS; el personal las ve todas
  y las acepta o rechaza.
- Notificaciones: cada quien ve las propias.
- Cuentas de clientes: solo el personal las crea y administra.
"""
from datetime import date

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import ProtectedError
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from ventas.models import Persona, PerfilUsuario
from ventas.permisos import (
    Autenticado, EsPersonal, PersonalOSoloLectura, SoloAdmin, es_cliente, es_personal,
)
from .models import AreaReserva, Notificacion, Reserva
from .serializers import AreaReservaSerializer, NotificacionSerializer, ReservaSerializer

MAX_COMPROBANTE_MB = 10


# ---------- Notificaciones internas: helpers ----------
def _notificar(usuario, mensaje, reserva=None):
    Notificacion.objects.create(user=usuario, mensaje=mensaje, reserva=reserva)


def _notificar_personal(mensaje, reserva=None):
    """Aviso para TODO el personal activo (admins y operativos)."""
    personal = User.objects.filter(is_active=True).exclude(perfil__rol=PerfilUsuario.Rol.CLIENTE)
    Notificacion.objects.bulk_create(
        [Notificacion(user=u, mensaje=mensaje, reserva=reserva) for u in personal]
    )


def _etiqueta(reserva):
    return f"{reserva.area.nombre} · {reserva.fecha.strftime('%d/%m/%Y')} {reserva.hora_inicio.strftime('%H:%M')}"


# ---------- Áreas ----------
class AreaReservaViewSet(viewsets.ModelViewSet):
    serializer_class = AreaReservaSerializer
    permission_classes = [PersonalOSoloLectura]

    def get_queryset(self):
        qs = AreaReserva.objects.all()
        # Los clientes solo ven las áreas activas (las inactivas no existen para ellos).
        if es_cliente(self.request.user):
            qs = qs.filter(activa=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        # Si el área ya tiene reservas, no se borra (PROTECT): se desactiva.
        try:
            return super().destroy(request, *args, **kwargs)
        except Exception:
            return Response(
                {"detail": "El área tiene reservas asociadas. Desactivala en lugar de borrarla."},
                status=status.HTTP_400_BAD_REQUEST,
            )


@api_view(["GET"])
@permission_classes([Autenticado])
def disponibilidad(request):
    """GET /api/reservas/disponibilidad/?area=ID&fecha=YYYY-MM-DD
    -> las franjas del área ese día, marcando cuáles están libres."""
    try:
        area = AreaReserva.objects.get(pk=request.query_params.get("area"))
        fecha = date.fromisoformat(request.query_params.get("fecha", ""))
    except (AreaReserva.DoesNotExist, ValueError):
        return Response(
            {"detail": "Parámetros requeridos: ?area=ID&fecha=YYYY-MM-DD."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Una franja está ocupada si tiene una reserva pendiente o aceptada
    # (las rechazadas liberan el espacio).
    ocupadas = set(
        Reserva.objects.filter(area=area, fecha=fecha)
        .exclude(estado=Reserva.Estado.RECHAZADA)
        .values_list("hora_inicio", flat=True)
    )
    return Response({
        "area": area.id,
        "fecha": fecha.isoformat(),
        "franjas": [
            {
                "hora_inicio": ini.strftime("%H:%M"),
                "hora_fin": fin.strftime("%H:%M"),
                "libre": ini not in ocupadas,
            }
            for ini, fin in area.franjas()
        ],
    })


# ---------- Reservas ----------
class ReservaViewSet(viewsets.ModelViewSet):
    serializer_class = ReservaSerializer
    permission_classes = [Autenticado]

    def get_queryset(self):
        qs = Reserva.objects.select_related("area", "cliente")
        if es_cliente(self.request.user):
            # El cliente SOLO ve (y por lo tanto solo toca) sus reservas.
            return qs.filter(cliente=self.request.user)
        estado = self.request.query_params.get("estado")
        fecha = self.request.query_params.get("fecha")
        if estado:
            qs = qs.filter(estado=estado)
        if fecha:
            qs = qs.filter(fecha=fecha)
        return qs

    def _validar_franja(self, area, fecha, hora_inicio, excluir_pk=None):
        """Devuelve (hora_fin, error). Chequea que la franja exista en el
        horario del área y que nadie más la tenga tomada."""
        if not area.activa:
            return None, "Esa área no está disponible."
        if fecha < timezone.localdate():
            return None, "No se puede reservar una fecha pasada."
        hora_fin = next((fin for ini, fin in area.franjas() if ini == hora_inicio), None)
        if hora_fin is None:
            return None, "Esa hora no corresponde a una franja válida del área."
        choque = (
            Reserva.objects.filter(area=area, fecha=fecha, hora_inicio=hora_inicio)
            .exclude(estado=Reserva.Estado.RECHAZADA)
            .exclude(pk=excluir_pk)
            .exists()
        )
        if choque:
            return None, "Esa franja ya está reservada. Elegí otra."
        return hora_fin, None

    def perform_create(self, serializer):
        if not es_cliente(self.request.user):
            raise _error("Solo los clientes hacen reservas (desde su cuenta).")
        datos = serializer.validated_data
        with transaction.atomic():
            hora_fin, error = self._validar_franja(
                datos["area"], datos["fecha"], datos["hora_inicio"]
            )
            if error:
                raise _error(error)
            reserva = serializer.save(
                cliente=self.request.user,
                hora_fin=hora_fin,
                precio=datos["area"].precio,  # snapshot
            )
        nombre = self.request.user.get_full_name() or self.request.user.username
        _notificar_personal(f"Nueva reserva de {nombre}: {_etiqueta(reserva)}", reserva)

    def perform_update(self, serializer):
        reserva = serializer.instance
        if reserva.cliente != self.request.user:
            raise _error("Solo el dueño de la reserva puede modificarla.")
        datos = serializer.validated_data
        with transaction.atomic():
            area = datos.get("area", reserva.area)
            fecha = datos.get("fecha", reserva.fecha)
            hora = datos.get("hora_inicio", reserva.hora_inicio)
            hora_fin, error = self._validar_franja(area, fecha, hora, excluir_pk=reserva.pk)
            if error:
                raise _error(error)
            # Al cambiarla vuelve a PENDIENTE: el personal debe revisarla de nuevo.
            serializer.save(
                hora_fin=hora_fin,
                precio=area.precio,
                estado=Reserva.Estado.PENDIENTE,
                motivo_rechazo="",
            )
        nombre = self.request.user.get_full_name() or self.request.user.username
        _notificar_personal(f"{nombre} modificó su reserva: {_etiqueta(reserva)}", reserva)

    def perform_destroy(self, instance):
        usuario = self.request.user
        etiqueta = _etiqueta(instance)
        dueno = instance.cliente  # se captura ANTES de borrar la fila
        if es_cliente(usuario) and dueno != usuario:
            raise _error("Solo el dueño de la reserva puede eliminarla.")
        instance.delete()
        if es_cliente(usuario):
            nombre = usuario.get_full_name() or usuario.username
            _notificar_personal(f"{nombre} canceló su reserva: {etiqueta}")
        else:
            _notificar(dueno, f"El personal canceló tu reserva: {etiqueta}")

    # ----- Comprobante de pago -----
    @action(detail=True, methods=["post", "get"])
    def comprobante(self, request, pk=None):
        reserva = self.get_object()  # el queryset ya limita al dueño si es cliente

        if request.method == "GET":
            # Descarga autenticada (dueño o personal): el archivo NO es público.
            if not reserva.comprobante:
                return Response({"detail": "La reserva no tiene comprobante."},
                                status=status.HTTP_404_NOT_FOUND)
            return FileResponse(reserva.comprobante.open("rb"),
                                filename=reserva.comprobante.name.rsplit("/", 1)[-1])

        # POST: subir. Solo el dueño.
        if reserva.cliente != request.user:
            return Response({"detail": "Solo el dueño puede adjuntar el comprobante."},
                            status=status.HTTP_403_FORBIDDEN)
        archivo = request.FILES.get("archivo")
        if archivo is None:
            return Response({"detail": "Adjuntá el archivo en el campo 'archivo'."},
                            status=status.HTTP_400_BAD_REQUEST)
        if archivo.size > MAX_COMPROBANTE_MB * 1024 * 1024:
            return Response({"detail": f"El archivo supera los {MAX_COMPROBANTE_MB} MB."},
                            status=status.HTTP_400_BAD_REQUEST)
        tipo = archivo.content_type or ""
        if not (tipo.startswith("image/") or tipo == "application/pdf"):
            return Response({"detail": "Solo se aceptan imágenes o PDF."},
                            status=status.HTTP_400_BAD_REQUEST)
        reserva.comprobante = archivo
        reserva.save()
        nombre = request.user.get_full_name() or request.user.username
        _notificar_personal(f"{nombre} adjuntó el comprobante de: {_etiqueta(reserva)}", reserva)
        return Response(ReservaSerializer(reserva).data)

    # ----- Aceptar / rechazar (solo personal) -----
    @action(detail=True, methods=["post"], permission_classes=[EsPersonal])
    def estado(self, request, pk=None):
        reserva = self.get_object()
        nuevo = request.data.get("estado")
        if nuevo not in (Reserva.Estado.ACEPTADA, Reserva.Estado.RECHAZADA):
            return Response({"detail": "El estado debe ser 'Aceptada' o 'Rechazada'."},
                            status=status.HTTP_400_BAD_REQUEST)
        reserva.estado = nuevo
        reserva.motivo_rechazo = (request.data.get("motivo") or "").strip() \
            if nuevo == Reserva.Estado.RECHAZADA else ""
        reserva.save()
        etiqueta = _etiqueta(reserva)
        if nuevo == Reserva.Estado.ACEPTADA:
            _notificar(reserva.cliente, f"✅ Tu reserva fue ACEPTADA: {etiqueta}", reserva)
        else:
            detalle = f" Motivo: {reserva.motivo_rechazo}" if reserva.motivo_rechazo else ""
            _notificar(reserva.cliente, f"❌ Tu reserva fue RECHAZADA: {etiqueta}.{detalle}", reserva)
        return Response(ReservaSerializer(reserva).data)


def _error(mensaje):
    from rest_framework.exceptions import ValidationError
    return ValidationError({"detail": mensaje})


# ---------- Notificaciones ----------
@api_view(["GET"])
@permission_classes([Autenticado])
def mis_notificaciones(request):
    """Las últimas 30 del usuario + cuántas no ha leído (para la campanita)."""
    propias = request.user.notificaciones.all()
    return Response({
        "no_leidas": propias.filter(leida=False).count(),
        "notificaciones": NotificacionSerializer(propias[:30], many=True).data,
    })


@api_view(["POST"])
@permission_classes([Autenticado])
def marcar_leidas(request):
    request.user.notificaciones.filter(leida=False).update(leida=True)
    return Response({"no_leidas": 0})


# ---------- Cuentas de clientes (las crea el personal) ----------
def _cuenta_a_json(user):
    perfil = getattr(user, "perfil", None)
    persona = perfil.persona if perfil else None
    return {
        "id": user.id,
        "username": user.username,
        "nombre": user.get_full_name() or user.username,
        "activo": user.is_active,
        "persona": persona.id if persona else None,
        "persona_nombre": f"{persona.codigo} · {persona.nombre}" if persona else None,
    }


@api_view(["GET", "POST"])
def cuentas_clientes(request):
    """
    GET  -> lista de cuentas de clientes.
    POST -> {"username", "password", "nombre", "persona": id opcional} crea una.
    Solo personal (permiso por defecto del sistema).
    """
    if request.method == "GET":
        clientes = User.objects.filter(
            perfil__rol=PerfilUsuario.Rol.CLIENTE
        ).select_related("perfil__persona").order_by("username")
        return Response([_cuenta_a_json(u) for u in clientes])

    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    nombre = (request.data.get("nombre") or "").strip()
    if not username or len(password) < 6:
        return Response(
            {"detail": "Usuario requerido y clave de al menos 6 caracteres."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username__iexact=username).exists():
        return Response({"detail": "Ese nombre de usuario ya existe."},
                        status=status.HTTP_400_BAD_REQUEST)
    persona = None
    if request.data.get("persona"):
        persona = Persona.objects.filter(pk=request.data["persona"]).first()
    with transaction.atomic():
        user = User.objects.create_user(username=username, password=password, first_name=nombre)
        PerfilUsuario.objects.create(user=user, rol=PerfilUsuario.Rol.CLIENTE, persona=persona)
    return Response(_cuenta_a_json(user), status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
def cuenta_cliente(request, user_id):
    """
    PUT {"activo": bool} activa/desactiva; {"password": "..."} cambia la clave.
    DELETE borra la cuenta por completo (si tiene reservas asociadas, no se
    puede: Reserva.cliente usa PROTECT para no perder el historial).
    """
    user = User.objects.filter(pk=user_id, perfil__rol=PerfilUsuario.Rol.CLIENTE).first()
    if user is None:
        return Response({"detail": "Cuenta no encontrada."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        try:
            user.delete()
        except ProtectedError:
            return Response(
                {"detail": "No se puede eliminar: el cliente tiene reservas registradas. "
                           "Desactivá la cuenta en su lugar."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    if "activo" in request.data:
        user.is_active = bool(request.data["activo"])
    if request.data.get("password"):
        if len(request.data["password"]) < 6:
            return Response({"detail": "La clave debe tener al menos 6 caracteres."},
                            status=status.HTTP_400_BAD_REQUEST)
        user.set_password(request.data["password"])
    user.save()
    return Response(_cuenta_a_json(user))


# ---------- Cuentas de personal (Admin / Operativo) — solo Admin ----------
def _personal_a_json(user):
    return {
        "id": user.id,
        "username": user.username,
        "nombre": user.get_full_name() or user.username,
        "rol": user.perfil.rol,
        "activo": user.is_active,
        "soy_yo": False,  # se completa por vista (necesita el request.user)
    }


@api_view(["GET"])
@permission_classes([SoloAdmin])
def usuarios_personal(request):
    """GET /api/usuarios-personal/ -> lista de cuentas Admin/Operativo."""
    personal = (
        User.objects.filter(perfil__rol__in=[PerfilUsuario.Rol.ADMIN, PerfilUsuario.Rol.OPERATIVO])
        .select_related("perfil")
        .order_by("perfil__rol", "username")
    )
    datos = []
    for u in personal:
        item = _personal_a_json(u)
        item["soy_yo"] = u.id == request.user.id
        datos.append(item)
    return Response(datos)


@api_view(["DELETE"])
@permission_classes([SoloAdmin])
def eliminar_usuario_personal(request, user_id):
    """
    DELETE /api/usuarios-personal/<id>/ -> borra una cuenta Admin u Operativo.
    Dos resguardos para no dejar el sistema sin dueño:
      - nadie puede borrar su propia cuenta desde acá.
      - no se puede borrar el ÚLTIMO administrador.
    """
    if user_id == request.user.id:
        return Response({"detail": "No podés eliminar tu propia cuenta."},
                        status=status.HTTP_400_BAD_REQUEST)
    user = User.objects.filter(
        pk=user_id, perfil__rol__in=[PerfilUsuario.Rol.ADMIN, PerfilUsuario.Rol.OPERATIVO]
    ).select_related("perfil").first()
    if user is None:
        return Response({"detail": "Cuenta no encontrada."}, status=status.HTTP_404_NOT_FOUND)
    if user.perfil.rol == PerfilUsuario.Rol.ADMIN:
        otros_admins = User.objects.filter(perfil__rol=PerfilUsuario.Rol.ADMIN).exclude(pk=user.id)
        if not otros_admins.exists():
            return Response(
                {"detail": "No se puede eliminar: es el único administrador del sistema."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    user.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
