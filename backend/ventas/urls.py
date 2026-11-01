from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AjusteInventarioViewSet,
    PersonaViewSet,
    CategoriaViewSet,
    ProductoViewSet,
    MovimientoViewSet,
    estado_dia,
    observacion_dia,
    buscar_cedula,
)
from .reportes import (
    pdf_resumen_dia,
    pdf_informe,
    pdf_rango_movimientos,
    pdf_existencias,
)
from .informes import informe_resumen
from .inventario import reporte_existencias, existencias_productos
from .membresias import estado_membresia_view, ajustar_vencimiento

# El router arma solas todas las rutas del CRUD de cada recurso.
router = DefaultRouter()
router.register("personas", PersonaViewSet, basename="persona")
router.register("categorias", CategoriaViewSet, basename="categoria")
router.register("productos", ProductoViewSet, basename="producto")
router.register("movimientos", MovimientoViewSet, basename="movimiento")
router.register("ajustes-inventario", AjusteInventarioViewSet, basename="ajuste-inventario")

urlpatterns = [
    path("", include(router.urls)),
    path("cedula/<str:cedula>/", buscar_cedula),
    path("membresias/estado/", estado_membresia_view),
    # Vencimiento fijado a mano (caso especial). Solo administradores.
    path("personas/<int:persona_id>/membresia/", ajustar_vencimiento),
    # Inventario: existencias de hoy y reporte de rotación del período.
    path("inventario/stock/", existencias_productos),
    path("inventario/existencias/", reporte_existencias),
    path("inventario/existencias/pdf/", pdf_existencias),
    path("dias/<str:fecha>/", estado_dia),
    path("dias/<str:fecha>/observacion/", observacion_dia),
    path("reportes/dia/<str:fecha>/pdf/", pdf_resumen_dia),
    path("reportes/rango/pdf/", pdf_rango_movimientos),
    # Informe administrativo (rango de fechas). Solo administradores.
    path("reportes/resumen/", informe_resumen),
    path("reportes/resumen/pdf/", pdf_informe),
]
