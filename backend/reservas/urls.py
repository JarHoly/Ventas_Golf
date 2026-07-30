from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AreaReservaViewSet,
    ReservaViewSet,
    disponibilidad,
    mis_notificaciones,
    marcar_leidas,
    notificacion_borrar,
    notificaciones_vaciar,
    push_clave_publica,
    push_suscripcion,
    cuentas_clientes,
    cuenta_cliente,
    usuarios_personal,
    eliminar_usuario_personal,
)

router = DefaultRouter()
router.register("areas", AreaReservaViewSet, basename="area")
router.register("reservas", ReservaViewSet, basename="reserva")

urlpatterns = [
    # OJO: las rutas fijas van ANTES del router para que "reservas/disponibilidad/"
    # no se confunda con "reservas/<pk>/".
    path("reservas/disponibilidad/", disponibilidad),
    path("notificaciones/", mis_notificaciones),
    path("notificaciones/leidas/", marcar_leidas),
    path("notificaciones/vaciar/", notificaciones_vaciar),
    path("notificaciones/<int:notif_id>/", notificacion_borrar),
    path("push/clave-publica/", push_clave_publica),
    path("push/suscripcion/", push_suscripcion),
    path("cuentas-clientes/", cuentas_clientes),
    path("cuentas-clientes/<int:user_id>/", cuenta_cliente),
    path("usuarios-personal/", usuarios_personal),
    path("usuarios-personal/<int:user_id>/", eliminar_usuario_personal),
    path("", include(router.urls)),
]
