import Swal from "sweetalert2";

/*
 * Alertas del sistema (SweetAlert2), con los colores del design system.
 * Centralizarlas aquí = un solo lugar para cambiar el estilo de TODAS.
 */

// Configuración base compartida por todas las alertas.
const base = Swal.mixin({
  confirmButtonColor: "#0056b3", // --primary
  cancelButtonColor: "#64748b",  // --text-muted
  buttonsStyling: true,
});

/**
 * Diálogo de confirmación para eliminar.
 * Devuelve true si el usuario confirmó.
 *   if (await confirmarEliminar("este cliente")) { ... }
 */
export async function confirmarEliminar(que) {
  const res = await base.fire({
    title: "¿Estás seguro?",
    text: `Se eliminará ${que}. Esta acción no se puede deshacer.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#ef4444", // rojo: acción destructiva
    reverseButtons: true,
  });
  return res.isConfirmed;
}

/** Alerta de error (reemplaza a alert()). */
export function mostrarError(mensaje) {
  return base.fire({
    title: "Ups...",
    text: mensaje,
    icon: "error",
    confirmButtonText: "Entendido",
  });
}

/** Aviso breve de éxito: aparece arriba a la derecha y se va solo. */
export function avisoExito(mensaje) {
  return Swal.fire({
    toast: true,
    position: "top-end",
    icon: "success",
    title: mensaje,
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
  });
}
