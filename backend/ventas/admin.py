from django.contrib import admin
from .models import Categoria, Persona, Producto, Movimiento


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
    list_display = ["nombre", "tipo", "uso", "precio_unitario", "categoria"]
    list_filter = ["tipo", "uso", "categoria"]
    search_fields = ["nombre"]


@admin.register(Movimiento)
class MovimientoAdmin(admin.ModelAdmin):
    list_display = ["fecha", "numero", "tipo", "persona", "producto", "cantidad", "precio_unitario", "total"]
    list_filter = ["tipo", "fecha", "metodo"]
    search_fields = ["persona__nombre", "producto__nombre"]
    readonly_fields = ["numero", "creado_en"]
