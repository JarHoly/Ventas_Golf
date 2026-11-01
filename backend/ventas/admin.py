from django.contrib import admin
from .models import (
    AjusteInventario,
    Categoria,
    Persona,
    Producto,
    Movimiento,
    ObservacionDia,
    PerfilUsuario,
)


@admin.register(PerfilUsuario)
class PerfilUsuarioAdmin(admin.ModelAdmin):
    list_display = ["user", "rol", "persona"]
    list_filter = ["rol"]


@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    list_display = ["nombre"]
    search_fields = ["nombre"]


@admin.register(Persona)
class PersonaAdmin(admin.ModelAdmin):
    list_display = ["codigo", "nombre", "cedula", "tipo", "telefono", "email"]
    list_filter = ["tipo"]
    search_fields = ["codigo", "nombre", "cedula"]
    readonly_fields = ["codigo"]


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = [
        "nombre", "tipo", "uso", "precio_unitario", "categoria",
        "controla_inventario",
    ]
    list_filter = ["tipo", "uso", "categoria", "controla_inventario"]
    search_fields = ["nombre"]


@admin.register(AjusteInventario)
class AjusteInventarioAdmin(admin.ModelAdmin):
    list_display = ["fecha", "producto", "tipo", "cantidad", "motivo", "registrado_por"]
    list_filter = ["tipo", "fecha", "producto"]
    search_fields = ["producto__nombre", "motivo"]
    readonly_fields = ["creado_en"]


@admin.register(ObservacionDia)
class ObservacionDiaAdmin(admin.ModelAdmin):
    list_display = ["fecha", "texto", "actualizado_por", "actualizado_en"]
    readonly_fields = ["actualizado_en"]


@admin.register(Movimiento)
class MovimientoAdmin(admin.ModelAdmin):
    list_display = [
        "fecha", "numero", "tipo", "persona", "producto", "cantidad",
        "precio_unitario", "moneda", "total",
    ]
    list_filter = ["tipo", "fecha", "metodo", "moneda"]
    search_fields = ["persona__nombre", "producto__nombre"]
    readonly_fields = ["numero", "creado_en"]
