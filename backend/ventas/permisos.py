"""
ROLES del sistema: Admin, Operativo y Cliente.

- Admin: todo (informes, reabrir días, observaciones, gestionar reservas).
- Operativo: opera el negocio (movimientos, catálogos, aprobar reservas)
  pero NO reabre días, NO edita observaciones y NO ve informes.
- Cliente: SOLO el portal de reservas. Nunca ve datos del negocio.

El rol vive en PerfilUsuario (ventas/models.py). Los usuarios viejos sin
perfil se tratan según is_staff (compatibilidad hacia atrás).
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS

ROL_ADMIN = "Admin"
ROL_OPERATIVO = "Operativo"
ROL_CLIENTE = "Cliente"


def rol_de(user):
    perfil = getattr(user, "perfil", None)
    if perfil is not None:
        return perfil.rol
    # Usuario sin perfil (creado antes de los roles): is_staff decide.
    return ROL_ADMIN if user.is_staff else ROL_OPERATIVO


def es_admin(user):
    return user.is_authenticated and rol_de(user) == ROL_ADMIN


def es_cliente(user):
    return user.is_authenticated and rol_de(user) == ROL_CLIENTE


def es_personal(user):
    """Admin u Operativo: la gente que trabaja en el negocio."""
    return user.is_authenticated and rol_de(user) in (ROL_ADMIN, ROL_OPERATIVO)


class SoloAdmin(BasePermission):
    """
    Permiso más estricto que EsPersonal: SOLO administradores. Se usa para
    lo más delicado (gestionar cuentas de Admin/Operativo) — un operativo
    no debe poder borrar a otro operativo ni a un admin.
    """
    message = "Solo un administrador puede hacer esto."

    def has_permission(self, request, view):
        return es_admin(request.user)


class EsPersonal(BasePermission):
    """
    Permiso POR DEFECTO de toda la API (settings.py): personal solamente.
    Así, si mañana se agrega un endpoint y se olvida el permiso, un cliente
    NO puede tocarlo. Los endpoints del portal lo abren explícitamente.
    """
    message = "Esta sección es solo para el personal del negocio."

    def has_permission(self, request, view):
        return es_personal(request.user)


class PersonalOSoloLectura(BasePermission):
    """Leer: cualquier usuario logueado. Escribir: solo personal.
    (Ej: las áreas de reserva — el cliente las ve, el personal las gestiona.)"""
    message = "Solo el personal puede modificar esto."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return request.method in SAFE_METHODS or es_personal(request.user)


class Autenticado(BasePermission):
    """Cualquier usuario logueado (personal o cliente)."""

    def has_permission(self, request, view):
        return request.user.is_authenticated
