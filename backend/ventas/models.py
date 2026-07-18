from django.db import models
from django.conf import settings


class Categoria(models.Model):
    """Categoría de un producto (ej: Bolas, Carritos, Clases...)."""
    nombre = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class Persona(models.Model):
    """Clientes, socios y proveedores viven en una sola tabla, separados por 'tipo'."""

    class Tipo(models.TextChoices):
        CLIENTE = "Cliente", "Cliente"
        SOCIO = "Socio", "Socio"
        PROVEEDOR = "Proveedor", "Proveedor"

    # Prefijo del código según el tipo: Cliente=CR, Socio=SC, Proveedor=PR
    PREFIJOS = {Tipo.CLIENTE: "CR", Tipo.SOCIO: "SC", Tipo.PROVEEDOR: "PR"}

    # 'codigo' es el identificador visible (CR0001). NO es la llave primaria:
    codigo = models.CharField(max_length=10, unique=True, blank=True, editable=False)
    cedula = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=150)
    telefono = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.CLIENTE)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return f"{self.codigo} · {self.nombre}"

    def save(self, *args, **kwargs):
        # Si aún no tiene código, lo generamos: prefijo + consecutivo de 4 dígitos.
        if not self.codigo:
            self.codigo = self._generar_codigo()
        super().save(*args, **kwargs)

    def _generar_codigo(self):
        prefijo = self.PREFIJOS[self.tipo]
        # Buscamos el último código con ese prefijo y le sumamos 1.
        ultimo = (
            Persona.objects.filter(codigo__startswith=prefijo)
            .order_by("-codigo")
            .first()
        )
        siguiente = int(ultimo.codigo[len(prefijo):]) + 1 if ultimo else 1
        return f"{prefijo}{siguiente:04d}"  # ej. CR0001


class Producto(models.Model):
    """Lo que se vende o se alquila."""

    class Tipo(models.TextChoices):
        ALQUILER = "Alquiler", "Alquiler"
        SERVICIO = "Servicio", "Servicio"
        UNIDAD = "Unidad", "Unidad"

    class Uso(models.TextChoices):
        VENTA = "Venta", "Venta"
        GASTO = "Gasto", "Gasto"

    nombre = models.CharField(max_length=150)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.UNIDAD)
    # ¿Este producto se usa en Ventas o en Gastos? El modal de movimientos
    # solo ofrece los productos que correspondan al tipo de movimiento.
    uso = models.CharField(max_length=10, choices=Uso.choices, default=Uso.VENTA)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2)
    categoria = models.ForeignKey(
        Categoria, on_delete=models.PROTECT, related_name="productos"
    )

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class Movimiento(models.Model):
    """Cada movimiento = un producto vendido o comprado en un día."""

    class Tipo(models.TextChoices):
        VENTA = "Venta", "Venta"
        GASTO = "Gasto", "Gasto"

    class Metodo(models.TextChoices):
        TRANSFERENCIA = "Transferencia", "Transferencia"
        EFECTIVO = "Efectivo", "Efectivo"
        SINPE = "Sinpe", "Sinpe"
        TARJETA = "Tarjeta", "Tarjeta"

    # Consecutivo VISIBLE que reinicia cada día (1, 2, 3... y al otro día vuelve a 1).
    numero = models.PositiveIntegerField(editable=False)
    fecha = models.DateField()
    persona = models.ForeignKey(Persona, on_delete=models.PROTECT, related_name="movimientos")
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT, related_name="movimientos")
    cantidad = models.PositiveIntegerField(default=1)
    # SNAPSHOT: se copia el precio del producto al momento de registrar.
    # Así, si mañana cambia el precio, este movimiento NO se altera (reporte histórico fiel).
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2)
    metodo = models.CharField(max_length=15, choices=Metodo.choices, default=Metodo.EFECTIVO)
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.VENTA)
    creado_en = models.DateTimeField(auto_now_add=True)

    # Quién lo registró (viene del login). Opcional, para auditoría.
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos",
    )

    class Meta:
        # Ordena por fecha y número descendente: lo más nuevo primero.
        ordering = ["-fecha", "-numero"]

    def __str__(self):
        return f"{self.fecha} #{self.numero} · {self.tipo} · {self.persona.nombre}"

    def save(self, *args, **kwargs):
        # Si no viene precio, lo copiamos del producto (snapshot).
        if self.precio_unitario is None and self.producto_id:
            self.precio_unitario = self.producto.precio_unitario
        # Asignamos el número consecutivo del día (solo al crear).
        if not self.numero:
            self.numero = self._siguiente_numero_del_dia()
        super().save(*args, **kwargs)

    def _siguiente_numero_del_dia(self):
        ultimo = (
            Movimiento.objects.filter(fecha=self.fecha).order_by("-numero").first()
        )
        return (ultimo.numero + 1) if ultimo else 1

    # ----- Totales calculados (NO se guardan, se calculan al vuelo) -----
    @property
    def subtotal(self):
        return self.cantidad * self.precio_unitario - self.descuento

    @property
    def total(self):
        # Sin impuesto por ahora; el día que se agregue IVA, se suma aquí.
        return self.subtotal


class CierreDia(models.Model):
    """
    "TERMINAR EL DÍA": si existe una fila aquí para una fecha, ese día está
    cerrado y sus movimientos quedan bloqueados (no crear/editar/borrar).
    Reabrir el día = borrar esta fila (solo administradores).
    """
    fecha = models.DateField(unique=True)
    cerrado_en = models.DateTimeField(auto_now_add=True)
    cerrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cierres",
    )

    class Meta:
        ordering = ["-fecha"]

    def __str__(self):
        return f"Cierre {self.fecha}"
