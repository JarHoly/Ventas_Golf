"""
DATOS DE PRUEBA para revisar el sistema en localhost.

    python manage.py sembrar_demo              -> carga los datos
    python manage.py sembrar_demo --limpiar    -> los borra y deja todo como estaba

Qué carga: productos (con y sin control de inventario), clientes con y sin
membresía, dos proveedores, el inventario inicial y los movimientos de
octubre de 2026 (ventas, alquileres de carrito y compras a proveedor).

NO toca nada de lo que ya había en la base: solo agrega lo suyo, y --limpiar
borra exactamente eso (lo reconoce por nombre/cédula, no por fecha).

Los números salen de una semilla fija, así que correrlo dos veces da el mismo
resultado — si hay que revisar un número con alguien, no se mueve.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from ventas.membresias import recalcular_membresia
from ventas.models import (
    AjusteInventario,
    Categoria,
    Movimiento,
    Persona,
    Producto,
)

# El "hoy" del escenario. Los movimientos llegan hasta acá y no más: una
# venta con fecha futura confundiría cualquier revisión.
HOY = date(2026, 10, 23)
PRIMER_DIA = date(2026, 10, 1)

CATEGORIAS = ["Pelotas", "Tienda", "Cafetería", "Clases", "Alquiler carritos", "Membresías"]

# (nombre, tipo, uso, precio, categoría, controla_inventario, rol_especial)
PRODUCTOS = [
    ("Caja de bolas Pro V1", "Unidad", "Venta", "55.00", "Pelotas", True, ""),
    ("Guantes de golf", "Unidad", "Venta", "28.00", "Tienda", True, ""),
    ("Gorra E-Cuestas", "Unidad", "Venta", "22.00", "Tienda", True, ""),
    ("Bebida hidratante", "Unidad", "Venta", "3.50", "Cafetería", True, ""),
    ("Tees de madera (bolsa)", "Unidad", "Venta", "6.00", "Tienda", True, ""),
    ("Clase particular", "Servicio", "Venta", "45.00", "Clases", False, ""),
    ("Membresía Anual Socio", "Servicio", "Venta", "850.00", "Membresías", False, "Membresia"),
    ("Alquiler de carrito 18 hoyos", "Alquiler", "Venta", "35.00", "Alquiler carritos", False, "Carrito"),
    ("Mantenimiento de cancha", "Servicio", "Gasto", "400.00", "Clases", False, ""),
]

# Existencia con la que arranca octubre (ajuste del 30/09). "Tees" arranca
# justo a propósito: termina el mes con 4 unidades, o sea en rojo y con
# sugerencia de compra — que es el caso que el reporte tiene que detectar.
INVENTARIO_INICIAL = {
    "Caja de bolas Pro V1": 40,
    "Guantes de golf": 25,
    "Gorra E-Cuestas": 30,
    "Bebida hidratante": 120,
    "Tees de madera (bolsa)": 24,
}

PROVEEDORES = [
    ("3-101-445566", "Distribuidora Golf Pro S.A.", "2224-1180", "ventas@golfpro.cr"),
    ("3-101-778899", "Bebidas del Valle S.A.", "2235-7744", "pedidos@bebidasvalle.cr"),
]

# (cédula, nombre, teléfono, email)
CLIENTES = [
    ("108970456", "María Fernanda Rojas Vargas", "8712-4455", "mf.rojas@gmail.com"),
    ("203450789", "Carlos Alberto Mora Jiménez", "8834-9012", "camora@gmail.com"),
    ("114560832", "Ana Lucía Céspedes Ramírez", "7055-3321", "alcespedes@gmail.com"),
    ("301230654", "José Pablo Quirós Araya", "8901-7766", "jpquiros@gmail.com"),
    ("112780945", "Silvia Elena Mata Brenes", "8645-2290", "se.mata@gmail.com"),
    ("206780123", "Randall Steven Vega Solano", "7123-8854", "rsvega@gmail.com"),
    ("109450678", "Gabriela Patricia Soto Chaves", "8990-1123", "gpsoto@gmail.com"),
    ("304560912", "Luis Diego Arias Montero", "8477-6690", "ldarias@gmail.com"),
    ("115670234", "Karla Vanessa Núñez Picado", "7788-4412", "kvnunez@gmail.com"),
    ("207890456", "Óscar Mauricio Delgado Rojas", "8322-9087", "omdelgado@gmail.com"),
]

# Qué membresía tiene cada cliente y cuándo la compró. Está armado para que
# al revisar se vea CADA caso del sistema, no solo el feliz:
#   - vigente cómodo, vigente por vencer, VENCIDA, y renovación que acumula.
# (cédula, [fechas de compra])
MEMBRESIAS = {
    "108970456": [date(2026, 10, 3)],                        # vigente (vence 03/10/2027)
    "203450789": [date(2026, 10, 8)],                        # vigente
    "114560832": [date(2026, 10, 15)],                       # vigente
    "301230654": [date(2025, 9, 15)],                        # VENCIDA el 15/09/2026
    "112780945": [date(2025, 11, 10)],                       # vence 10/11/2026: por vencer
    "206780123": [date(2025, 10, 20), date(2026, 10, 5)],    # renovó antes de vencer:
                                                             # vence 20/10/2027, NO 05/10/2027
}

METODOS = ["Efectivo", "Tarjeta", "Sinpe", "Transferencia"]


class Command(BaseCommand):
    help = "Carga (o borra con --limpiar) datos de prueba de octubre de 2026."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limpiar",
            action="store_true",
            help="Borra los datos de prueba en vez de crearlos.",
        )

    def handle(self, *args, **opciones):
        if opciones["limpiar"]:
            self.limpiar()
        else:
            self.sembrar()

    # ------------------------------------------------------------------
    def _nombres_demo(self):
        return [fila[0] for fila in PRODUCTOS]

    def _cedulas_demo(self):
        return [c[0] for c in CLIENTES] + [p[0] for p in PROVEEDORES]

    @transaction.atomic
    def limpiar(self):
        productos = Producto.objects.filter(nombre__in=self._nombres_demo())
        personas = Persona.objects.filter(cedula__in=self._cedulas_demo())

        # Primero los movimientos: las FK son PROTECT, así que mientras
        # existan no se puede borrar ni el producto ni la persona.
        movs = Movimiento.objects.filter(persona__in=personas) | Movimiento.objects.filter(
            producto__in=productos
        )
        n_movs = movs.distinct().count()
        movs.distinct().delete()

        n_ajustes = AjusteInventario.objects.filter(producto__in=productos).count()
        AjusteInventario.objects.filter(producto__in=productos).delete()

        # Las membresías se van en cascada con la persona, pero si algún
        # cliente de prueba quedó enganchado a un producto que NO es de
        # prueba, el recálculo lo deja consistente.
        n_personas = personas.count()
        personas.delete()
        n_productos = productos.count()
        productos.delete()

        # Categorías que quedaron vacías y las había creado este comando.
        vacias = Categoria.objects.filter(nombre__in=["Tienda", "Cafetería"], productos__isnull=True)
        n_cats = vacias.count()
        vacias.delete()

        self.stdout.write(self.style.SUCCESS(
            f"Borrado: {n_movs} movimientos, {n_ajustes} ajustes, "
            f"{n_personas} personas, {n_productos} productos, {n_cats} categorías."
        ))

    # ------------------------------------------------------------------
    @transaction.atomic
    def sembrar(self):
        import random

        azar = random.Random(20261023)  # semilla fija: siempre los mismos números

        # ---------- Categorías ----------
        categorias = {}
        for nombre in CATEGORIAS:
            categorias[nombre], _ = Categoria.objects.get_or_create(nombre=nombre)

        # ---------- Productos ----------
        productos = {}
        for nombre, tipo, uso, precio, categoria, inventario, rol in PRODUCTOS:
            producto, _ = Producto.objects.update_or_create(
                nombre=nombre,
                defaults={
                    "tipo": tipo,
                    "uso": uso,
                    "precio_unitario": Decimal(precio),
                    "categoria": categorias[categoria],
                    "controla_inventario": inventario,
                    "rol_especial": rol,
                    "dias_vigencia": 365,
                    "usos_carrito": 50,
                },
            )
            productos[nombre] = producto

        # ---------- Personas ----------
        clientes = {}
        for cedula, nombre, telefono, email in CLIENTES:
            persona, _ = Persona.objects.get_or_create(
                cedula=cedula,
                defaults={
                    "nombre": nombre, "telefono": telefono,
                    "email": email, "tipo": Persona.Tipo.CLIENTE,
                },
            )
            clientes[cedula] = persona

        proveedores = []
        for cedula, nombre, telefono, email in PROVEEDORES:
            persona, _ = Persona.objects.get_or_create(
                cedula=cedula,
                defaults={
                    "nombre": nombre, "telefono": telefono,
                    "email": email, "tipo": Persona.Tipo.PROVEEDOR,
                },
            )
            proveedores.append(persona)

        # ---------- Inventario inicial (30/09, la víspera) ----------
        for nombre, cantidad in INVENTARIO_INICIAL.items():
            AjusteInventario.objects.get_or_create(
                producto=productos[nombre],
                tipo=AjusteInventario.Tipo.INICIAL,
                fecha=PRIMER_DIA - timedelta(days=1),
                defaults={
                    "cantidad": cantidad,
                    "motivo": "Carga inicial de bodega al arrancar el sistema",
                },
            )

        # ---------- Membresías ----------
        membresia = productos["Membresía Anual Socio"]
        for cedula, fechas in MEMBRESIAS.items():
            for fecha in fechas:
                self._venta(
                    clientes[cedula], membresia, fecha,
                    cantidad=1, metodo="Transferencia",
                )

        # ---------- Movimientos de octubre ----------
        carrito = productos["Alquiler de carrito 18 hoyos"]
        bebida = productos["Bebida hidratante"]
        bolas = productos["Caja de bolas Pro V1"]
        guantes = productos["Guantes de golf"]
        gorra = productos["Gorra E-Cuestas"]
        tees = productos["Tees de madera (bolsa)"]
        clase = productos["Clase particular"]

        con_membresia = [clientes[c] for c in MEMBRESIAS]
        todos = list(clientes.values())

        dia = PRIMER_DIA
        while dia <= HOY:
            # Fin de semana: más juego, más carritos y más cafetería.
            finde = dia.weekday() >= 5

            # Carritos: los socios son los que los alquilan (es lo que
            # descuenta usos de su membresía).
            for persona in azar.sample(con_membresia, 3 if finde else 2):
                self._venta(persona, carrito, dia, azar.randint(1, 2), azar.choice(METODOS))

            # Cafetería: lo que más se mueve.
            for persona in azar.sample(todos, 4 if finde else 2):
                self._venta(persona, bebida, dia, azar.randint(1, 3), "Efectivo",
                            moneda="CRC" if azar.random() < 0.35 else "USD")

            # Tienda: no todos los días.
            if azar.random() < 0.45:
                self._venta(azar.choice(todos), bolas, dia, 1, azar.choice(METODOS))
            if azar.random() < 0.35:
                self._venta(azar.choice(todos), guantes, dia, 1, azar.choice(METODOS))
            if azar.random() < 0.25:
                self._venta(azar.choice(todos), gorra, dia, 1, azar.choice(METODOS))
            if azar.random() < 0.55:
                self._venta(azar.choice(todos), tees, dia, azar.randint(1, 2), "Efectivo")

            # Clases: entre semana.
            if not finde and azar.random() < 0.5:
                self._venta(azar.choice(todos), clase, dia, 1, azar.choice(METODOS))

            dia += timedelta(days=1)

        # ---------- Compras al proveedor (gastos que SUMAN inventario) ----------
        compras = [
            (date(2026, 10, 2), proveedores[0], bolas, 24, "40.00"),
            (date(2026, 10, 2), proveedores[0], guantes, 20, "19.00"),
            (date(2026, 10, 9), proveedores[1], bebida, 96, "1.80"),
            (date(2026, 10, 16), proveedores[0], gorra, 15, "14.00"),
            (date(2026, 10, 16), proveedores[0], bolas, 12, "40.00"),
        ]
        for fecha, proveedor, producto, cantidad, costo in compras:
            self._movimiento(
                proveedor, producto, fecha, cantidad, "Transferencia",
                tipo=Movimiento.Tipo.GASTO, precio=Decimal(costo),
            )

        # Un gasto que NO toca inventario, para ver la diferencia.
        self._movimiento(
            proveedores[0], productos["Mantenimiento de cancha"],
            date(2026, 10, 12), 1, "Transferencia",
            tipo=Movimiento.Tipo.GASTO,
        )

        # ---------- Merma (sale sin pasar por caja) ----------
        AjusteInventario.objects.get_or_create(
            producto=bebida,
            tipo=AjusteInventario.Tipo.SALIDA,
            fecha=date(2026, 10, 14),
            defaults={"cantidad": 6, "motivo": "Botellas vencidas en la cámara"},
        )

        # ---------- Recalcular las membresías ----------
        # Los movimientos se crearon directo contra el modelo (no por la API),
        # así que acá se dispara a mano lo que normalmente hace la vista.
        for cedula in MEMBRESIAS:
            recalcular_membresia(clientes[cedula])

        self._resumen(clientes, productos)

    # ------------------------------------------------------------------
    def _venta(self, persona, producto, fecha, cantidad, metodo, moneda="USD"):
        return self._movimiento(persona, producto, fecha, cantidad, metodo, moneda=moneda)

    def _movimiento(self, persona, producto, fecha, cantidad, metodo,
                    tipo=Movimiento.Tipo.VENTA, precio=None, moneda="USD"):
        precio = precio if precio is not None else producto.precio_unitario
        # En colones el precio se expresa en colones (no hay conversión en el
        # sistema: cada movimiento vive en su moneda).
        if moneda == "CRC":
            precio = (precio * 520).quantize(Decimal("1"))
        return Movimiento.objects.create(
            fecha=fecha, persona=persona, producto=producto, tipo=tipo,
            cantidad=cantidad, precio_unitario=precio, metodo=metodo, moneda=moneda,
        )

    def _resumen(self, clientes, productos):
        from ventas.inventario import calcular_existencias
        from ventas.membresias import estado_membresia

        movs = Movimiento.objects.filter(fecha__range=(PRIMER_DIA, HOY))
        self.stdout.write(self.style.SUCCESS(
            f"\nCargado: {movs.count()} movimientos entre el {PRIMER_DIA} y el {HOY}."
        ))

        self.stdout.write("\nMEMBRESÍAS")
        for cedula in MEMBRESIAS:
            persona = clientes[cedula]
            estado = estado_membresia(persona, HOY)
            if not estado["tiene_membresia"]:
                continue
            etiqueta = "VENCIDA" if estado["vencida"] else "vigente"
            self.stdout.write(
                f"  {persona.codigo} {persona.nombre[:28]:<28} {etiqueta:<8} "
                f"vence {estado['vence_el']} · usos {estado['usos_consumidos']}/{estado['usos_incluidos']}"
            )

        self.stdout.write("\nEXISTENCIAS AL " + HOY.isoformat())
        reporte = calcular_existencias(PRIMER_DIA, HOY)
        for fila in reporte["productos"]:
            alerta = "  <-- reponer" if fila["sugerido_comprar"] else ""
            self.stdout.write(
                f"  {fila['producto'][:26]:<26} inicial {fila['existencia_inicial']:>4} "
                f"compras {fila['compras']:>4} vendidas {fila['ventas']:>4} "
                f"= {fila['existencia']:>4}{alerta}"
            )
