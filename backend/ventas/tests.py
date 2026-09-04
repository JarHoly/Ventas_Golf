from datetime import date

from django.test import TestCase

from .membresias import estado_membresia, recalcular_membresia, recalcular_por_producto
from .models import Categoria, Membresia, Movimiento, Persona, Producto


class MembresiaTests(TestCase):
    """
    Las dos reglas del negocio: renovar NO pierde días, pero SÍ reinicia
    los usos de carrito.
    """

    def setUp(self):
        self.categoria = Categoria.objects.create(nombre="Membresías")
        self.cliente = Persona.objects.create(cedula="1-1111-1111", nombre="Cliente Prueba")
        self.membresia_anual = Producto.objects.create(
            nombre="Membresía ULTIMATE",
            precio_unitario=500,
            categoria=self.categoria,
            rol_especial=Producto.RolEspecial.MEMBRESIA,
            dias_vigencia=365,
            usos_carrito=50,
        )
        self.carrito = Producto.objects.create(
            nombre="Alquiler carrito golf",
            precio_unitario=10,
            categoria=self.categoria,
            rol_especial=Producto.RolEspecial.CARRITO,
        )

    def _vender(self, producto, fecha, cantidad=1):
        return Movimiento.objects.create(
            fecha=fecha, persona=self.cliente, producto=producto,
            cantidad=cantidad, precio_unitario=producto.precio_unitario,
        )

    # ---------- Vigencia ----------

    def test_primera_compra_vence_un_ano_despues(self):
        self._vender(self.membresia_anual, date(2026, 8, 31))
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 8, 31))

    def test_renovar_antes_de_vencer_suma_los_dias_que_sobraban(self):
        """El caso exacto del negocio: vence el 31/08 y renueva el 29/08.
        Le sobraban 2 días, así que la nueva vence 365 días DESPUÉS del
        vencimiento viejo (no 365 después del 29/08)."""
        self._vender(self.membresia_anual, date(2025, 8, 31))  # vence 31/08/2026
        self._vender(self.membresia_anual, date(2026, 8, 29))  # renueva 2 días antes
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 8, 31))

    def test_renovar_despues_de_vencer_arranca_desde_la_compra(self):
        """Si ya se le venció, no se le regalan los días que dejó pasar."""
        self._vender(self.membresia_anual, date(2024, 1, 1))  # venció 01/01/2025
        self._vender(self.membresia_anual, date(2025, 6, 1))  # renueva 5 meses tarde
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2026, 6, 1))

    def test_comprar_cantidad_2_da_doble_vigencia(self):
        self._vender(self.membresia_anual, date(2026, 1, 1), cantidad=2)
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2028, 1, 1))  # 730 días

    # ---------- Usos de carrito ----------

    def test_usos_se_descuentan_por_cantidad(self):
        self._vender(self.membresia_anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._vender(self.carrito, date(2026, 2, 1), cantidad=3)
        self._vender(self.carrito, date(2026, 2, 2), cantidad=2)
        estado = estado_membresia(self.cliente, date(2026, 2, 3))
        self.assertEqual(estado["usos_consumidos"], 5)
        self.assertEqual(estado["usos_restantes"], 45)
        self.assertFalse(estado["excedido"])

    def test_pasarse_del_limite_reporta_la_fecha_exacta(self):
        self._vender(self.membresia_anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._vender(self.carrito, date(2026, 3, 1), cantidad=49)
        self._vender(self.carrito, date(2026, 5, 20), cantidad=2)  # acá se pasa (51)
        self._vender(self.carrito, date(2026, 6, 1), cantidad=1)
        estado = estado_membresia(self.cliente, date(2026, 6, 2))
        self.assertTrue(estado["excedido"])
        self.assertEqual(estado["fecha_excedido"], "2026-05-20")
        self.assertEqual(estado["usos_consumidos"], 52)
        self.assertEqual(estado["usos_restantes"], 0)

    def test_justo_en_el_limite_no_esta_excedido(self):
        self._vender(self.membresia_anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._vender(self.carrito, date(2026, 3, 1), cantidad=50)
        estado = estado_membresia(self.cliente, date(2026, 3, 2))
        self.assertFalse(estado["excedido"])
        self.assertEqual(estado["usos_restantes"], 0)

    def test_renovar_reinicia_los_usos(self):
        """Aunque haya gastado los 50, al renovar vuelve a tener 50 —
        los usos NO se acumulan (a diferencia de los días)."""
        self._vender(self.membresia_anual, date(2025, 1, 1))
        recalcular_membresia(self.cliente)
        self._vender(self.carrito, date(2025, 6, 1), cantidad=50)
        self._vender(self.membresia_anual, date(2025, 12, 1))  # renueva
        recalcular_membresia(self.cliente)
        estado = estado_membresia(self.cliente, date(2025, 12, 2))
        self.assertEqual(estado["usos_consumidos"], 0)
        self.assertEqual(estado["usos_restantes"], 50)
        self.assertFalse(estado["excedido"])

    def test_usos_de_antes_de_renovar_no_cuentan(self):
        """Los carritos usados en el período anterior quedan fuera."""
        self._vender(self.membresia_anual, date(2025, 1, 1))
        self._vender(self.carrito, date(2025, 3, 1), cantidad=10)
        self._vender(self.membresia_anual, date(2025, 6, 1))  # renueva
        self._vender(self.carrito, date(2025, 7, 1), cantidad=4)
        recalcular_membresia(self.cliente)
        estado = estado_membresia(self.cliente, date(2025, 8, 1))
        self.assertEqual(estado["usos_consumidos"], 4)

    def test_excluir_movimiento_lo_saca_de_la_cuenta(self):
        """Al EDITAR un movimiento de carrito no debe contarse a sí mismo."""
        self._vender(self.membresia_anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        mov = self._vender(self.carrito, date(2026, 2, 1), cantidad=5)
        estado = estado_membresia(self.cliente, date(2026, 2, 1), excluir_movimiento_id=mov.pk)
        self.assertEqual(estado["usos_consumidos"], 0)

    # ---------- Estado / vencimiento ----------

    def test_sin_membresia_devuelve_estado_vacio(self):
        estado = estado_membresia(self.cliente, date(2026, 1, 1))
        self.assertFalse(estado["tiene_membresia"])

    def test_membresia_vencida_se_marca_como_vencida(self):
        self._vender(self.membresia_anual, date(2024, 1, 1))
        recalcular_membresia(self.cliente)
        self.assertTrue(estado_membresia(self.cliente, date(2026, 1, 1))["vencida"])
        self.assertFalse(estado_membresia(self.cliente, date(2024, 6, 1))["vencida"])

    # ---------- Recálculo / autocorrección ----------

    def test_borrar_el_movimiento_borra_la_membresia(self):
        mov = self._vender(self.membresia_anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self.assertTrue(Membresia.objects.filter(persona=self.cliente).exists())
        mov.delete()
        recalcular_membresia(self.cliente)
        self.assertFalse(Membresia.objects.filter(persona=self.cliente).exists())

    def test_marcar_el_producto_arma_el_historial_ya_registrado(self):
        """El caso de la migración: las ventas viejas ya están en la base y
        el producto se marca como membresía DESPUÉS."""
        normal = Producto.objects.create(
            nombre="Membresía vieja", precio_unitario=500, categoria=self.categoria,
        )
        self._vender(normal, date(2026, 1, 1))
        self.assertFalse(Membresia.objects.filter(persona=self.cliente).exists())

        normal.rol_especial = Producto.RolEspecial.MEMBRESIA
        normal.dias_vigencia = 365
        normal.usos_carrito = 50
        normal.save()
        recalcular_por_producto(normal)

        membresia = Membresia.objects.get(persona=self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 1, 1))
