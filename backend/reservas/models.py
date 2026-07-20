"""
Portal de reservas: áreas del campo de golf, reservas de clientes
y notificaciones internas del sistema.
"""
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

# Un cliente tiene 24 horas para adjuntar el comprobante de pago;
# pasado ese plazo la reserva se marca como "posible inválida".
HORAS_PLAZO_COMPROBANTE = 24


class AreaReserva(models.Model):
    """
    Un área reservable del campo (ej: Campo 1, Driving Range, Putting Green).
    Cada área define su horario, la DURACIÓN de su bloque y el precio por
    bloque; las franjas se generan solas: apertura, apertura+bloque, ...
    """
    nombre = models.CharField(max_length=100, unique=True)
    descripcion = models.TextField(blank=True)
    precio = models.DecimalField(max_digits=12, decimal_places=2)  # USD por bloque
    duracion_minutos = models.PositiveIntegerField(default=60)
    hora_apertura = models.TimeField(default=time(6, 0))
    hora_cierre = models.TimeField(default=time(18, 0))
    # Desactivar un área la esconde del portal sin borrar su historial.
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre

    @staticmethod
    def _como_time(valor):
        """Acepta time o texto 'HH:MM' (ej. recién asignado sin recargar de BD)."""
        return valor if isinstance(valor, time) else time.fromisoformat(str(valor))

    def franjas(self):
        """[(inicio, fin), ...] — los bloques del día según el horario del área."""
        base = timezone.localdate()
        cursor = datetime.combine(base, self._como_time(self.hora_apertura))
        cierre = datetime.combine(base, self._como_time(self.hora_cierre))
        paso = timedelta(minutes=self.duracion_minutos)
        resultado = []
        while cursor + paso <= cierre:
            resultado.append((cursor.time(), (cursor + paso).time()))
            cursor += paso
        return resultado


class Reserva(models.Model):
    """
    Una reserva de un cliente: área + fecha + franja. Nace PENDIENTE y el
    personal la acepta o la rechaza. hora_fin y precio son SNAPSHOT (si el
    área cambia su duración o precio después, esta reserva no se altera).
    """

    class Estado(models.TextChoices):
        PENDIENTE = "Pendiente", "Pendiente"
        ACEPTADA = "Aceptada", "Aceptada"
        RECHAZADA = "Rechazada", "Rechazada"

    cliente = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reservas"
    )
    area = models.ForeignKey(AreaReserva, on_delete=models.PROTECT, related_name="reservas")
    fecha = models.DateField()
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()          # snapshot de la duración del área
    precio = models.DecimalField(max_digits=12, decimal_places=2)  # snapshot
    comprobante = models.FileField(upload_to="comprobantes/%Y/%m/", blank=True)
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PENDIENTE)
    motivo_rechazo = models.TextField(blank=True)
    creada_en = models.DateTimeField(auto_now_add=True)
    actualizada_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha", "-hora_inicio"]

    def __str__(self):
        return f"{self.fecha} {self.hora_inicio} · {self.area} · {self.cliente.username}"

    @property
    def comprobante_vencido(self):
        """True si sigue pendiente, sin comprobante, y ya pasaron 24h:
        'posible reservación inválida' para que el personal la revise."""
        return (
            self.estado == self.Estado.PENDIENTE
            and not self.comprobante
            and timezone.now() > self.creada_en + timedelta(hours=HORAS_PLAZO_COMPROBANTE)
        )


class Notificacion(models.Model):
    """Notificación interna: la campanita del navbar la consulta."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notificaciones"
    )
    mensaje = models.CharField(max_length=255)
    reserva = models.ForeignKey(
        Reserva, on_delete=models.SET_NULL, null=True, blank=True, related_name="notificaciones"
    )
    leida = models.BooleanField(default=False)
    creada_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creada_en"]

    def __str__(self):
        return f"{self.user.username}: {self.mensaje[:40]}"
