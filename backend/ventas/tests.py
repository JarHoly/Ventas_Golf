from datetime import date, datetime

from django.test import TestCase
from django.utils import timezone

from .inventario import calcular_existencias, existencia_actual, leer_dias_objetivo
from .membresias import estado_membresia, recalcular_membresia, recalcular_por_producto
from .models import (
    AjusteInventario,
    Categoria,
    Membresia,
    Movimiento,
    Persona,
    Producto,
)


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


class VencimientoManualTests(TestCase):
    """
    CASO ESPECIAL: el administrador fija el vencimiento a mano.

    La regla acordada: esa fecha MANDA y PERSISTE — sobrevive a los
    recálculos, y si el cliente renueva después, los días de la renovación
    se suman SOBRE la fecha manual (no se pierde el ajuste).
    """

    def setUp(self):
        self.categoria = Categoria.objects.create(nombre="Membresías")
        self.cliente = Persona.objects.create(cedula="2-2222-2222", nombre="Socio Prueba")
        self.anual = Producto.objects.create(
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

    def _fijar(self, vence_el, fijado_el):
        """Simula lo que hace el endpoint: fecha manual + fecha del ajuste."""
        membresia = Membresia.objects.get(persona=self.cliente)
        membresia.vence_el_manual = vence_el
        membresia.ajuste_motivo = "Convenio con el socio"
        # Se guarda como datetime porque es el dato de auditoría; el recálculo
        # usa su fecha local para ubicar el ajuste en la línea de tiempo.
        membresia.ajustada_en = timezone.make_aware(
            datetime(fijado_el.year, fijado_el.month, fijado_el.day, 10, 0)
        )
        membresia.save()
        return membresia

    def test_la_fecha_manual_reemplaza_a_la_calculada(self):
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)  # vencería 01/01/2027
        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 6, 30))

    def test_el_ajuste_sobrevive_al_recalculo(self):
        """Editar o borrar OTRO movimiento no debe pisar el ajuste manual."""
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        recalcular_membresia(self.cliente)
        # Un movimiento de carrito cualquiera dispara recálculos en la app.
        self._vender(self.carrito, date(2026, 4, 1))
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 6, 30))
        self.assertEqual(membresia.vence_el_manual, date(2027, 6, 30))
        self.assertEqual(membresia.ajuste_motivo, "Convenio con el socio")

    def test_renovar_despues_del_ajuste_suma_sobre_la_fecha_manual(self):
        """La regla 1 (no perder días) se aplica sobre la fecha MANUAL."""
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        recalcular_membresia(self.cliente)
        # Renueva estando vigente: 365 días SOBRE el 30/06/2027.
        self._vender(self.anual, date(2027, 5, 1))
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2028, 6, 29))  # 30/06/2027 + 365

    def test_ajuste_que_revive_una_membresia_vencida(self):
        """Si el admin la extiende más allá de la renovación tardía, esa
        renovación pasa a contar como 'estando vigente' y acumula días."""
        self._vender(self.anual, date(2024, 1, 1))  # vencía 01/01/2025
        recalcular_membresia(self.cliente)
        self._fijar(date(2026, 1, 1), fijado_el=date(2025, 1, 15))
        recalcular_membresia(self.cliente)
        self._vender(self.anual, date(2025, 6, 1))  # renueva dentro de la extensión
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 1, 1))  # 01/01/2026 + 365

    def test_quitar_el_ajuste_vuelve_a_la_fecha_calculada(self):
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        recalcular_membresia(self.cliente)

        membresia = Membresia.objects.get(persona=self.cliente)
        membresia.vence_el_manual = None
        membresia.ajuste_motivo = ""
        membresia.ajustada_en = None
        membresia.save()
        membresia = recalcular_membresia(self.cliente)
        self.assertEqual(membresia.vence_el, date(2027, 1, 1))

    def test_el_estado_informa_que_la_fecha_es_manual(self):
        """El frontend lo necesita para explicar por qué la fecha no cuadra
        con el cálculo (y mostrar el motivo)."""
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self.assertFalse(estado_membresia(self.cliente, date(2026, 2, 1))["ajuste_manual"])

        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        recalcular_membresia(self.cliente)
        estado = estado_membresia(self.cliente, date(2026, 4, 1))
        self.assertTrue(estado["ajuste_manual"])
        self.assertEqual(estado["ajuste_motivo"], "Convenio con el socio")
        self.assertEqual(estado["vence_el"], "2027-06-30")

    def test_los_usos_se_cuentan_hasta_la_fecha_manual(self):
        """Extender el vencimiento extiende también la ventana de usos: el
        carrito del período extendido tiene que contar."""
        self._vender(self.anual, date(2026, 1, 1))
        recalcular_membresia(self.cliente)
        self._fijar(date(2027, 6, 30), fijado_el=date(2026, 3, 1))
        recalcular_membresia(self.cliente)
        self._vender(self.carrito, date(2027, 5, 1), cantidad=3)  # después del cálculo original
        estado = estado_membresia(self.cliente, date(2027, 5, 2))
        self.assertEqual(estado["usos_consumidos"], 3)
        self.assertFalse(estado["vencida"])


class InventarioTests(TestCase):
    """
    EXISTENCIAS Y ROTACIÓN.

    La existencia NO se guarda: se calcula como
    inventario inicial + ajustes + compras (gastos) − ventas.
    """

    def setUp(self):
        self.categoria = Categoria.objects.create(nombre="Tienda")
        self.cliente = Persona.objects.create(cedula="3-3333-3333", nombre="Cliente Tienda")
        self.proveedor = Persona.objects.create(
            cedula="3-9999-9999", nombre="Proveedor Bolas", tipo=Persona.Tipo.PROVEEDOR,
        )
        # Lleva existencias: es mercadería física.
        self.bolas = Producto.objects.create(
            nombre="Caja de bolas", precio_unitario=25,
            categoria=self.categoria, controla_inventario=True,
        )
        # NO lleva existencias: es un servicio.
        self.clase = Producto.objects.create(
            nombre="Clase de golf", precio_unitario=40,
            categoria=self.categoria, controla_inventario=False,
        )

    def _mover(self, producto, fecha, cantidad, tipo=Movimiento.Tipo.VENTA):
        persona = self.proveedor if tipo == Movimiento.Tipo.GASTO else self.cliente
        return Movimiento.objects.create(
            fecha=fecha, persona=persona, producto=producto, tipo=tipo,
            cantidad=cantidad, precio_unitario=producto.precio_unitario,
        )

    def _ajustar(self, fecha, cantidad, tipo, producto=None):
        return AjusteInventario.objects.create(
            producto=producto or self.bolas, fecha=fecha, tipo=tipo,
            cantidad=cantidad, motivo="prueba",
        )

    def _fila(self, desde, hasta, producto=None, **extra):
        reporte = calcular_existencias(desde, hasta, **extra)
        producto = producto or self.bolas
        return next(f for f in reporte["productos"] if f["producto_id"] == producto.id)

    # ---------- Existencia ----------

    def test_la_compra_suma_y_la_venta_resta(self):
        self._mover(self.bolas, date(2026, 3, 1), 100, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 5), 30)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["compras"], 100)
        self.assertEqual(fila["ventas"], 30)
        self.assertEqual(fila["existencia"], 70)

    def test_el_inventario_inicial_es_un_ajuste(self):
        self._ajustar(date(2026, 1, 1), 40, AjusteInventario.Tipo.INICIAL)
        fila = self._fila(date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(fila["ajustes_entrada"], 40)
        self.assertEqual(fila["existencia"], 40)

    def test_la_merma_resta(self):
        self._ajustar(date(2026, 1, 1), 40, AjusteInventario.Tipo.INICIAL)
        self._ajustar(date(2026, 1, 10), 5, AjusteInventario.Tipo.SALIDA)
        fila = self._fila(date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(fila["ajustes_salida"], 5)
        self.assertEqual(fila["existencia"], 35)

    def test_lo_de_antes_del_periodo_es_existencia_inicial(self):
        """El reporte de marzo no 'pierde' lo comprado en febrero."""
        self._mover(self.bolas, date(2026, 2, 1), 100, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 10), 20)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["existencia_inicial"], 100)
        self.assertEqual(fila["compras"], 0)
        self.assertEqual(fila["existencia"], 80)

    def test_los_productos_sin_control_no_aparecen(self):
        self._mover(self.clase, date(2026, 3, 1), 10)
        reporte = calcular_existencias(date(2026, 3, 1), date(2026, 3, 31))
        nombres = [f["producto"] for f in reporte["productos"]]
        self.assertIn("Caja de bolas", nombres)
        self.assertNotIn("Clase de golf", nombres)

    def test_la_existencia_de_hoy_usa_todo_el_historial(self):
        self._mover(self.bolas, date(2020, 1, 1), 50, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 6, 1), 10)
        self.assertEqual(existencia_actual()[self.bolas.id], 40)

    def test_borrar_la_compra_corrige_la_existencia_sola(self):
        """La razón de no guardar saldos: nada queda desfasado."""
        compra = self._mover(self.bolas, date(2026, 3, 1), 100, Movimiento.Tipo.GASTO)
        self.assertEqual(existencia_actual()[self.bolas.id], 100)
        compra.delete()
        self.assertEqual(existencia_actual()[self.bolas.id], 0)

    # ---------- Rotación, cobertura y sugerencia ----------

    def test_rotacion_sobre_la_existencia_promedio(self):
        """100 iniciales, vende 50 -> promedio (100+50)/2 = 75 -> 0.67x."""
        self._ajustar(date(2026, 2, 1), 100, AjusteInventario.Tipo.INICIAL)
        self._mover(self.bolas, date(2026, 3, 10), 50)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["existencia_inicial"], 100)
        self.assertEqual(fila["existencia"], 50)
        self.assertEqual(fila["rotacion"], 0.67)

    def test_promedio_diario_y_cobertura(self):
        """Vende 30 en 30 días = 1 por día; quedan 70 -> 70 días de stock."""
        self._mover(self.bolas, date(2026, 3, 1), 100, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 15), 30)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 30))
        self.assertEqual(fila["promedio_diario"], 1.0)
        self.assertEqual(fila["dias_cobertura"], 70.0)

    def test_sugerencia_de_compra_cubre_el_horizonte(self):
        """1 por día y quedan 10: para cubrir 30 días faltan 20."""
        self._ajustar(date(2026, 2, 28), 40, AjusteInventario.Tipo.INICIAL)
        self._mover(self.bolas, date(2026, 3, 15), 30)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 30), dias_objetivo=30)
        self.assertEqual(fila["existencia"], 10)
        self.assertEqual(fila["sugerido_comprar"], 20)

    def test_sin_ventas_no_se_sugiere_nada(self):
        """Sin ritmo de venta no hay forma de estimar: no se inventa."""
        self._mover(self.bolas, date(2026, 3, 1), 100, Movimiento.Tipo.GASTO)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["promedio_diario"], 0)
        self.assertIsNone(fila["dias_cobertura"])
        self.assertEqual(fila["sugerido_comprar"], 0)

    def test_sin_existencias_no_revienta_la_rotacion(self):
        """Producto nuevo sin nada registrado: promedio 0 -> rotación None."""
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["existencia"], 0)
        self.assertIsNone(fila["rotacion"])

    def test_producto_agotado_queda_marcado(self):
        self._mover(self.bolas, date(2026, 3, 1), 10, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 2), 10)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(fila["existencia"], 0)
        self.assertTrue(fila["alerta"])

    def test_totales_del_reporte(self):
        self._mover(self.bolas, date(2026, 3, 1), 100, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 5), 40)
        self._ajustar(date(2026, 3, 6), 2, AjusteInventario.Tipo.SALIDA)
        reporte = calcular_existencias(date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(reporte["totales"]["entradas"], 100)
        self.assertEqual(reporte["totales"]["salidas"], 42)
        self.assertEqual(reporte["totales"]["existencia"], 58)
        self.assertEqual(reporte["totales"]["ventas"], 40)

    def test_el_horizonte_se_limita_a_un_rango_sensato(self):
        """?dias_objetivo fuera de 7..365 se recorta: una sugerencia a 2 días
        o a 10 años no significa nada."""
        class _Pedido:
            def __init__(self, valor):
                self.query_params = {"dias_objetivo": valor}

        self.assertEqual(leer_dias_objetivo(_Pedido("45")), 45)
        self.assertEqual(leer_dias_objetivo(_Pedido("2")), 7)
        self.assertEqual(leer_dias_objetivo(_Pedido("9999")), 365)
        self.assertEqual(leer_dias_objetivo(_Pedido("no es un número")), 30)

    def test_no_hay_columna_duplicada_de_frecuencia(self):
        """'Cada cuántos días reponer' ES 'alcanza para': tenerlo como dato
        aparte hacía que la misma fila mostrara el número dos veces (y con
        redondeos distintos). No debe volver."""
        self._ajustar(date(2026, 2, 28), 120, AjusteInventario.Tipo.INICIAL)
        self._mover(self.bolas, date(2026, 3, 10), 85)
        fila = self._fila(date(2026, 3, 1), date(2026, 3, 31))
        self.assertNotIn("frecuencia_dias", fila)
        self.assertIsNotNone(fila["dias_cobertura"])

    def test_totales_desglosados_por_columna(self):
        """La fila de TOTALES tiene una columna por concepto: compras y
        ajustes no pueden venir sumados en el mismo número."""
        self._ajustar(date(2026, 2, 20), 10, AjusteInventario.Tipo.INICIAL)
        self._ajustar(date(2026, 3, 5), 4, AjusteInventario.Tipo.ENTRADA)
        self._ajustar(date(2026, 3, 6), 1, AjusteInventario.Tipo.SALIDA)
        self._mover(self.bolas, date(2026, 3, 2), 30, Movimiento.Tipo.GASTO)
        self._mover(self.bolas, date(2026, 3, 8), 7)
        totales = calcular_existencias(date(2026, 3, 1), date(2026, 3, 31))["totales"]
        self.assertEqual(totales["existencia_inicial"], 10)
        self.assertEqual(totales["compras"], 30)
        self.assertEqual(totales["ajustes_entrada"], 4)
        # Neto con signo: es lo que va en la columna "Ajustes" de la tabla.
        self.assertEqual(totales["ajustes"], 3)
        self.assertEqual(totales["ventas"], 7)
        self.assertEqual(totales["ajustes_salida"], 1)
        self.assertEqual(totales["existencia"], 36)
        # Y los agregados siguen cuadrando con el desglose.
        self.assertEqual(totales["entradas"], 34)
        self.assertEqual(totales["salidas"], 8)
