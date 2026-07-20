from django.contrib import admin
from .models import AreaReserva, Reserva, Notificacion


@admin.register(AreaReserva)
class AreaReservaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "precio", "duracion_minutos", "hora_apertura", "hora_cierre", "activa"]
    list_filter = ["activa"]


@admin.register(Reserva)
class ReservaAdmin(admin.ModelAdmin):
    list_display = ["fecha", "hora_inicio", "area", "cliente", "estado", "precio", "creada_en"]
    list_filter = ["estado", "area", "fecha"]
    search_fields = ["cliente__username", "cliente__first_name"]


@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ["user", "mensaje", "leida", "creada_en"]
    list_filter = ["leida"]
