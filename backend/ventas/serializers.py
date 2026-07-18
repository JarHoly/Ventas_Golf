from rest_framework import serializers
from .models import Categoria, Persona, Producto, Movimiento


class PersonaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Persona
        fields = ["id", "codigo", "cedula", "nombre", "telefono", "email", "tipo"]
        # 'codigo' se genera solo en el backend: el frontend no lo manda.
        read_only_fields = ["id", "codigo"]


class CategoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categoria
        fields = ["id", "nombre"]


class ProductoSerializer(serializers.ModelSerializer):
    # Campo extra de solo lectura: el nombre de la categoría (para mostrar en la
    # tabla sin que el frontend tenga que buscarlo aparte).
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True)

    class Meta:
        model = Producto
        fields = ["id", "nombre", "tipo", "uso", "precio_unitario", "categoria", "categoria_nombre"]


class MovimientoSerializer(serializers.ModelSerializer):
    # Datos "espejo" de solo lectura para pintar la tabla sin consultas extra.
    persona_nombre = serializers.CharField(source="persona.nombre", read_only=True)
    persona_tipo = serializers.CharField(source="persona.tipo", read_only=True)
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)
    categoria_id = serializers.IntegerField(source="producto.categoria_id", read_only=True)
    # Los totales son @property del modelo: se calculan, no se guardan.
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Movimiento
        fields = [
            "id", "numero", "fecha", "tipo", "metodo",
            "persona", "persona_nombre", "persona_tipo",
            "producto", "producto_nombre", "categoria_id",
            "cantidad", "precio_unitario", "descuento",
            "subtotal", "total", "creado_en",
        ]
        read_only_fields = ["id", "numero", "creado_en"]

    def validate(self, datos):
        """El descuento no puede superar el monto de la línea (cantidad × precio):
        un total negativo no tiene sentido y produce reportes confusos."""
        cantidad = datos.get("cantidad", getattr(self.instance, "cantidad", 1))
        precio = datos.get("precio_unitario", getattr(self.instance, "precio_unitario", 0))
        descuento = datos.get("descuento", getattr(self.instance, "descuento", 0))
        if descuento > cantidad * precio:
            raise serializers.ValidationError(
                {"descuento": "El descuento no puede ser mayor que cantidad × precio."}
            )
        return datos
