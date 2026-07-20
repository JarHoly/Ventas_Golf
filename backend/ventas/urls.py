from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PersonaViewSet,
    CategoriaViewSet,
    ProductoViewSet,
    MovimientoViewSet,
    estado_dia,
    observacion_dia,
    buscar_cedula,
)
from .reportes import pdf_resumen_dia, pdf_informe
from .informes import informe_resumen

# El router arma solas todas las rutas del CRUD de cada recurso.
router = DefaultRouter()
router.register("personas", PersonaViewSet, basename="persona")
router.register("categorias", CategoriaViewSet, basename="categoria")
router.register("productos", ProductoViewSet, basename="producto")
router.register("movimientos", MovimientoViewSet, basename="movimiento")

urlpatterns = [
    path("", include(router.urls)),
    path("cedula/<str:cedula>/", buscar_cedula),
    path("dias/<str:fecha>/", estado_dia),
    path("dias/<str:fecha>/observacion/", observacion_dia),
    path("reportes/dia/<str:fecha>/pdf/", pdf_resumen_dia),
    # Informe administrativo (rango de fechas). Solo administradores.
    path("reportes/resumen/", informe_resumen),
    path("reportes/resumen/pdf/", pdf_informe),
]
