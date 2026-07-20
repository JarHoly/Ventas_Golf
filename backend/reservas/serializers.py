from rest_framework import serializers

from .models import AreaReserva, Reserva, Notificacion


class AreaReservaSerializer(serializers.ModelSerializer):
    class Meta:
        model = AreaReserva
        fields = [
            "id", "nombre", "descripcion", "precio", "duracion_minutos",
            "hora_apertura", "hora_cierre", "activa",
        ]


class ReservaSerializer(serializers.ModelSerializer):
    # El cliente solo manda área + fecha + hora de inicio; todo lo demás
    # (hora_fin, precio, estado...) lo calcula o decide el backend.
    area_nombre = serializers.CharField(source="area.nombre", read_only=True)
    cliente_nombre = serializers.SerializerMethodField()
    tiene_comprobante = serializers.SerializerMethodField()
    comprobante_vencido = serializers.ReadOnlyField()

    class Meta:
        model = Reserva
        fields = [
            "id", "area", "area_nombre", "fecha", "hora_inicio", "hora_fin",
            "precio", "estado", "motivo_rechazo", "tiene_comprobante",
            "comprobante_vencido", "cliente", "cliente_nombre", "creada_en",
        ]
        read_only_fields = [
            "hora_fin", "precio", "estado", "motivo_rechazo", "cliente", "creada_en",
        ]

    def get_cliente_nombre(self, obj):
        return obj.cliente.get_full_name() or obj.cliente.username

    def get_tiene_comprobante(self, obj):
        return bool(obj.comprobante)


class NotificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notificacion
        fields = ["id", "mensaje", "reserva", "leida", "creada_en"]
