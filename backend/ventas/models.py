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

    class RolEspecial(models.TextChoices):
        """
        Cómo participa el producto en el control de membresías. Se configura
        acá (y no quemado en el código) porque el negocio decide qué producto
        es la membresía y cuál descuenta usos: puede haber varias membresías
        con distinta vigencia, y varios productos de carrito.
        """
        MEMBRESIA = "Membresia", "Membresía"
        CARRITO = "Carrito", "Carrito de golf"

    nombre = models.CharField(max_length=150)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.UNIDAD)
    # ¿Este producto se usa en Ventas o en Gastos? El modal de movimientos
    # solo ofrece los productos que correspondan al tipo de movimiento.
    uso = models.CharField(max_length=10, choices=Uso.choices, default=Uso.VENTA)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2)
    categoria = models.ForeignKey(
        Categoria, on_delete=models.PROTECT, related_name="productos"
    )
    # Vacío = producto normal (no participa del control de membresías).
    rol_especial = models.CharField(
        max_length=10, choices=RolEspecial.choices, blank=True, default=""
    )
    # Los dos campos de abajo SOLO aplican si rol_especial == "Membresia".
    # Días que dura la membresía (365 = anual).
    dias_vigencia = models.PositiveIntegerField(default=365)
    # Usos de carrito incluidos en cada período de la membresía.
    usos_carrito = models.PositiveIntegerField(default=50)

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

    class Moneda(models.TextChoices):
        USD = "USD", "USD"
        CRC = "CRC", "CRC"

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
    # Moneda en la que se registró el movimiento. precio_unitario/descuento/
    # subtotal/total quedan expresados en ESA moneda (colones si es CRC).
    # NO se lleva tipo de cambio ni conversión: los reportes muestran el
    # total en dólares y el total en colones por separado, sin mezclarlos.
    moneda = models.CharField(max_length=3, choices=Moneda.choices, default=Moneda.USD)
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


class Membresia(models.Model):
    """
    Estado ACTUAL de la membresía de una persona.

    NO se edita a mano y NO lleva contadores: se recalcula entera desde los
    movimientos de productos marcados como "Membresía" (ver
    ventas/membresias.py). Gracias a eso, si se corrige o se borra un
    movimiento, la membresía se corrige sola — nunca queda desfasada.

    Los usos de carrito consumidos TAMPOCO se guardan acá: se cuentan al
    vuelo desde los movimientos de productos marcados como "Carrito" dentro
    del período vigente, por la misma razón.
    """
    persona = models.OneToOneField(
        Persona, on_delete=models.CASCADE, related_name="membresia"
    )
    # Qué membresía tiene vigente (la del último movimiento de renovación).
    producto = models.ForeignKey(
        Producto, on_delete=models.PROTECT, related_name="membresias"
    )
    # Fecha de la última compra/renovación: desde acá se cuentan los usos,
    # porque al renovar los usos se reinician (los días sí se acumulan).
    inicia_el = models.DateField()
    vence_el = models.DateField()
    # Snapshot de los usos que incluía el producto al momento de renovar: si
    # mañana cambian el paquete a 60, las membresías ya vendidas no cambian.
    usos_incluidos = models.PositiveIntegerField()
    actualizada_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-vence_el"]

    def __str__(self):
        return f"{self.persona.nombre} · vence {self.vence_el}"


class PerfilUsuario(models.Model):
    """
    El ROL de cada usuario del sistema. Complementa al User de Django:
    - Admin / Operativo = personal del negocio.
    - Cliente = solo el portal de reservas; 'persona' lo enlaza con su
      ficha de la tabla Persona (código CRxxxx) si el personal la asoció.
    """

    class Rol(models.TextChoices):
        ADMIN = "Admin", "Admin"
        OPERATIVO = "Operativo", "Operativo"
        CLIENTE = "Cliente", "Cliente"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="perfil"
    )
    rol = models.CharField(max_length=10, choices=Rol.choices, default=Rol.OPERATIVO)
    persona = models.ForeignKey(
        Persona, on_delete=models.SET_NULL, null=True, blank=True, related_name="perfiles"
    )

    def __str__(self):
        return f"{self.user.username} · {self.rol}"


class ObservacionDia(models.Model):
    """
    Observaciones del día que se imprimen en el PDF. UN texto por fecha,
    editable SOLO por administradores (lo valida la vista, no el modelo).

    Va en tabla propia (y no como campo de CierreDia) a propósito: reabrir
    un día BORRA su CierreDia, y las observaciones deben sobrevivir a eso.
    """
    fecha = models.DateField(unique=True)
    texto = models.TextField(blank=True)
    actualizado_en = models.DateTimeField(auto_now=True)
    actualizado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="observaciones",
    )

    class Meta:
        ordering = ["-fecha"]

    def __str__(self):
        return f"Observaciones {self.fecha}"


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
