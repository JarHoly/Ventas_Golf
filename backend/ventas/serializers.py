from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers
from .models import AjusteInventario, Categoria, Persona, Producto, Movimiento


class PersonaSerializer(serializers.ModelSerializer):
    # Resumen de la membresía para pintarlo en la tabla de clientes sin
    # pedir un endpoint por fila. Son datos de la tabla Membresia (una FK
    # inversa 1-1), no de Persona: de ahí que sean de solo lectura.
    membresia_vence_el = serializers.DateField(source="membresia.vence_el", read_only=True)
    membresia_producto = serializers.CharField(source="membresia.producto.nombre", read_only=True)
    # ¿La fecha la fijó un administrador a mano? La tabla lo marca para que
    # nadie se sorprenda de que no coincida con el cálculo automático.
    membresia_manual = serializers.SerializerMethodField()
    membresia_estado = serializers.SerializerMethodField()

    class Meta:
        model = Persona
        fields = [
            "id", "codigo", "cedula", "nombre", "telefono", "email", "tipo",
            "membresia_vence_el", "membresia_producto",
            "membresia_manual", "membresia_estado",
        ]
        # 'codigo' se genera solo en el backend: el frontend no lo manda.
        read_only_fields = ["id", "codigo"]

    def get_membresia_manual(self, persona):
        membresia = getattr(persona, "membresia", None)
        return membresia is not None and membresia.vence_el_manual is not None

    def get_membresia_estado(self, persona):
        """'' (no tiene) · 'Vigente' · 'Vencida'. Lo resuelve el backend para
        que la tabla no tenga que comparar fechas en el navegador."""
        membresia = getattr(persona, "membresia", None)
        if membresia is None:
            return ""
        return "Vencida" if membresia.vence_el < timezone.localdate() else "Vigente"


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
        fields = [
            "id", "nombre", "tipo", "uso", "precio_unitario",
            "categoria", "categoria_nombre",
            "rol_especial", "dias_vigencia", "usos_carrito",
            "controla_inventario",
        ]


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
            "cantidad", "precio_unitario", "descuento", "moneda",
            "subtotal", "total", "creado_en",
        ]
        read_only_fields = ["id", "numero", "creado_en"]

    def validate(self, datos):
        """El descuento no puede superar el monto de la línea (cantidad × precio):
        un total negativo no tiene sentido y produce reportes confusos."""
        metodo = datos.get("metodo", getattr(self.instance, "metodo", None))

        # REGALÍA siempre va en CERO. Se fuerza acá, en el backend, y no solo
        # en la pantalla: es la regla que hace que lo regalado no sume un peso
        # a los ingresos, y tiene que valer venga de donde venga el dato.
        if metodo == Movimiento.Metodo.REGALIA:
            datos["precio_unitario"] = Decimal("0")
            datos["descuento"] = Decimal("0")
            return datos

        cantidad = datos.get("cantidad", getattr(self.instance, "cantidad", 1))
        precio = datos.get("precio_unitario", getattr(self.instance, "precio_unitario", 0))
        descuento = datos.get("descuento", getattr(self.instance, "descuento", 0))
        if descuento > cantidad * precio:
            raise serializers.ValidationError(
                {"descuento": "El descuento no puede ser mayor que cantidad × precio."}
            )
        return datos


class AjusteInventarioSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)
    # Cuánto suma o resta a la existencia (lo decide el tipo, no el usuario).
    efecto = serializers.IntegerField(read_only=True)
    registrado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = AjusteInventario
        fields = [
            "id", "producto", "producto_nombre", "fecha", "tipo",
            "cantidad", "efecto", "motivo",
            "registrado_por_nombre", "creado_en",
        ]
        read_only_fields = ["id", "creado_en"]

    def get_registrado_por_nombre(self, ajuste):
        quien = ajuste.registrado_por
        return (quien.get_full_name() or quien.username) if quien else None

    def validate_cantidad(self, cantidad):
        if cantidad <= 0:
            raise serializers.ValidationError(
                "La cantidad debe ser mayor que cero: el signo lo pone el tipo de ajuste."
            )
        return cantidad

    def validate_motivo(self, motivo):
        if not motivo.strip():
            raise serializers.ValidationError(
                "Escribí el motivo del ajuste: queda registrado para auditoría."
            )
        return motivo.strip()

    def validate_producto(self, producto):
        """Un ajuste sobre un producto que no lleva existencias no significa
        nada (y no aparecería en ningún reporte): se rechaza de entrada."""
        if not producto.controla_inventario:
            raise serializers.ValidationError(
                f'"{producto.nombre}" no controla inventario. Activá esa opción '
                f"en el producto si querés llevarle existencias."
            )
        return producto
