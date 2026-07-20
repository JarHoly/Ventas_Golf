# Migración de DATOS: los usuarios creados antes del sistema de roles
# reciben su perfil según is_staff (staff -> Admin, resto -> Operativo).
# Así los operativos reales que ya existen en producción siguen entrando
# igual que siempre, ahora con rol explícito.
from django.db import migrations


def crear_perfiles(apps, schema_editor):
    User = apps.get_model("auth", "User")
    PerfilUsuario = apps.get_model("ventas", "PerfilUsuario")
    for user in User.objects.filter(perfil__isnull=True):
        PerfilUsuario.objects.create(
            user=user,
            rol="Admin" if user.is_staff else "Operativo",
        )


def eliminar_perfiles(apps, schema_editor):
    # Reversa: borrar todos los perfiles (volver al mundo sin roles).
    apps.get_model("ventas", "PerfilUsuario").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("ventas", "0005_perfilusuario"),
    ]

    operations = [
        migrations.RunPython(crear_perfiles, eliminar_perfiles),
    ]
