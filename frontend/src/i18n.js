import { createContext, useCallback, useContext, useState } from "react";

// Diccionario ES/EN. Por ahora cubre: login, el portal del cliente
// (reservas) y las notificaciones — que es lo que el cliente usa.
// El panel del personal (Movimientos, Informes, etc.) sigue en español.
const DICCIONARIO = {
  es: {
    // Login
    "login.subtitulo": "Sistema de Ventas v1.0",
    "login.bienvenido": "¡Bienvenido de vuelta!",
    "login.accede": "Accede a tu panel de control de ventas",
    "login.usuario": "Usuario",
    "login.clave": "Contraseña",
    "login.recuerdame": "Recuérdame",
    "login.ingresando": "Ingresando...",
    "login.iniciar_sesion": "Iniciar Sesión",

    // Navbar / menú del cliente
    "nav.mis_reservas": "Mis Reservas",
    "nav.cerrar_sesion": "Cerrar sesión",

    // Notificaciones
    "notif.titulo": "Notificaciones",
    "notif.vacia": "No tenés notificaciones.",

    // Portal de reservas del cliente
    "res.titulo": "Reservas",
    "res.hacer_reserva": "Hacer una reserva",
    "res.mis_reservas": "Mis reservas",
    "res.sin_areas": "Por ahora no hay áreas disponibles para reservar.",
    "res.sin_reservas": "Todavía no tenés reservas. ¡Hacé la primera arriba!",
    "res.cambiando": "Cambiando reserva",
    "res.dia": "Día:",
    "res.cerrar": "Cerrar",
    "res.buscando_horarios": "Buscando horarios...",
    "res.sin_franjas": "El área no tiene franjas ese día.",
    "res.libre": "Libre",
    "res.ocupada": "Ocupada",
    "res.comprobante": "Comprobante",
    "res.adjuntar_comprobante": "Adjuntar comprobante",
    "res.cambiar": "Cambiar",
    "res.confirmar_reserva": "¿Confirmar reserva?",
    "res.confirmar_cambio": "¿Cambiar tu reserva?",
    "res.precio": "Precio:",
    "res.si_reservar": "Sí, reservar",
    "res.si_cambiar": "Sí, cambiar",
    "res.volver": "Volver",
    "res.reserva_creada": "¡Reserva creada!",
    "res.reserva_creada_detalle":
      "Quedó <b>pendiente de aprobación</b>.<br/>Recordá adjuntar tu comprobante de pago en las próximas <b>24 horas</b>, o podría invalidarse.",
    "res.reserva_cambiada": "Reserva cambiada: queda pendiente de aprobación",
    "res.comprobante_adjuntado": "Comprobante adjuntado",
    "res.aviso_adjuntar": "Adjuntá tu comprobante de pago (te quedan ~{h}h).",
    "res.aviso_vencido": "Pasaron 24h sin comprobante: tu reserva puede ser invalidada.",
    "res.area_no_disponible": "El área de esta reserva ya no está disponible.",
    "res.eliminar_titulo": "¿Estás seguro?",
    "res.eliminar_texto": "Esta acción no se puede deshacer.",
    "res.eliminar_confirmar": "Sí, eliminar",
    "res.eliminar_cancelar": "Cancelar",
    "res.eliminada": "Reserva eliminada",
    "res.min": "min",

    // Estados de una reserva
    "estado.Pendiente": "Pendiente",
    "estado.Aceptada": "Aceptada",
    "estado.Rechazada": "Rechazada",
  },

  en: {
    // Login
    "login.subtitulo": "Sales System v1.0",
    "login.bienvenido": "Welcome back!",
    "login.accede": "Access your sales control panel",
    "login.usuario": "Username",
    "login.clave": "Password",
    "login.recuerdame": "Remember me",
    "login.ingresando": "Signing in...",
    "login.iniciar_sesion": "Sign In",

    "nav.mis_reservas": "My Reservations",
    "nav.cerrar_sesion": "Log out",

    "notif.titulo": "Notifications",
    "notif.vacia": "You have no notifications.",

    "res.titulo": "Reservations",
    "res.hacer_reserva": "Make a reservation",
    "res.mis_reservas": "My reservations",
    "res.sin_areas": "There are no areas available to book right now.",
    "res.sin_reservas": "You don't have any reservations yet. Make your first one above!",
    "res.cambiando": "Changing reservation",
    "res.dia": "Day:",
    "res.cerrar": "Close",
    "res.buscando_horarios": "Looking up available times...",
    "res.sin_franjas": "This area has no time slots that day.",
    "res.libre": "Available",
    "res.ocupada": "Booked",
    "res.comprobante": "Receipt",
    "res.adjuntar_comprobante": "Attach payment receipt",
    "res.cambiar": "Change",
    "res.confirmar_reserva": "Confirm reservation?",
    "res.confirmar_cambio": "Change your reservation?",
    "res.precio": "Price:",
    "res.si_reservar": "Yes, book it",
    "res.si_cambiar": "Yes, change it",
    "res.volver": "Go back",
    "res.reserva_creada": "Reservation created!",
    "res.reserva_creada_detalle":
      "It's now <b>pending approval</b>.<br/>Remember to attach your payment receipt within the next <b>24 hours</b>, or it may be invalidated.",
    "res.reserva_cambiada": "Reservation changed: pending approval again",
    "res.comprobante_adjuntado": "Receipt attached",
    "res.aviso_adjuntar": "Attach your payment receipt (~{h}h left).",
    "res.aviso_vencido": "24h passed with no receipt: your reservation may be invalidated.",
    "res.area_no_disponible": "This reservation's area is no longer available.",
    "res.eliminar_titulo": "Are you sure?",
    "res.eliminar_texto": "This action cannot be undone.",
    "res.eliminar_confirmar": "Yes, delete it",
    "res.eliminar_cancelar": "Cancel",
    "res.eliminada": "Reservation deleted",
    "res.min": "min",

    "estado.Pendiente": "Pending",
    "estado.Aceptada": "Accepted",
    "estado.Rechazada": "Rejected",
  },
};

const CLAVE_STORAGE = "idioma";
const IdiomaContext = createContext(null);

export function IdiomaProvider({ children }) {
  const [idioma, setIdiomaState] = useState(
    () => localStorage.getItem(CLAVE_STORAGE) || "es",
  );

  const setIdioma = useCallback((nuevo) => {
    localStorage.setItem(CLAVE_STORAGE, nuevo);
    setIdiomaState(nuevo);
  }, []);

  // t("res.aviso_adjuntar", {h: 5}) -> reemplaza {h} en el texto.
  const t = useCallback(
    (clave, variables) => {
      let texto = DICCIONARIO[idioma][clave] ?? DICCIONARIO.es[clave] ?? clave;
      if (variables) {
        for (const [k, v] of Object.entries(variables)) {
          texto = texto.replace(`{${k}}`, v);
        }
      }
      return texto;
    },
    [idioma],
  );

  return (
    <IdiomaContext.Provider value={{ idioma, setIdioma, t }}>
      {children}
    </IdiomaContext.Provider>
  );
}

export function useIdioma() {
  const ctx = useContext(IdiomaContext);
  if (!ctx) throw new Error("useIdioma debe usarse dentro de <IdiomaProvider>");
  return ctx;
}
