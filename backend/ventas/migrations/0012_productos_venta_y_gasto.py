"""
Los productos que se compran Y se venden pasan al uso "Ambos".

Hasta ahora, un producto de venta que llevaba inventario aparecía en el modal
de Gasto por una regla implícita del frontend ("si controla inventario, se
puede comprar"). Con el uso "Ambos" eso se declara en la ficha del producto,
que es donde se entiende, y la regla implícita desaparece.

Esta migración mueve los que ya venían funcionando así, para que nadie tenga
que volver a marcarlos a mano después de actualizar.
"""
from django.db import migrations


def marcar_venta_y_gasto(apps, schema_editor):
    Producto = apps.get_model("ventas", "Producto")
    # Solo los de VENTA con inventario: son exactamente los que el frontend
    # venía ofreciendo también en los gastos. Los de uso Gasto se quedan como
    # están (un insumo que se compra y se consume, no se vende).
    Producto.objects.filter(uso="Venta", controla_inventario=True).update(uso="Ambos")


def volver_a_venta(apps, schema_editor):
    """
    Marcha atrás: los de inventario vuelven a "Venta", que es de donde
    salieron. Los que el usuario haya marcado "Ambos" a mano sin inventario
    no se tocan, porque no hay forma de distinguirlos y perder ese dato sería
    peor que dejarlos.
    """
    Producto = apps.get_model("ventas", "Producto")
    Producto.objects.filter(uso="Ambos", controla_inventario=True).update(uso="Venta")


class Migration(migrations.Migration):

    dependencies = [
        ("ventas", "0011_alter_producto_uso"),
    ]

    operations = [
        migrations.RunPython(marcar_venta_y_gasto, volver_a_venta),
    ]
