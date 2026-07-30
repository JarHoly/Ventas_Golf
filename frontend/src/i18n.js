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
    "notif.vaciar": "Vaciar todas",
    "notif.borrar": "Eliminar",

    // Portal de reservas del cliente
    "res.titulo": "Reservas",
    "res.hacer_reserva": "Hacer una reserva",
    "res.mis_reservas": "Mis reservas",
    "res.sin_areas": "Por ahora no hay áreas disponibles para reservar.",
    "res.sin_reservas": "Todavía no tenés reservas. ¡Hacé la primera arriba!",
    "res.sin_proximas": "No tenés reservas próximas. ¡Hacé una arriba!",
    "res.historial": "Historial",
    "res.cambiando": "Cambiando reserva",
    "res.dia": "Día:",
    "res.cerrar": "Cerrar",
    "res.buscando_horarios": "Buscando horarios...",
    "res.sin_franjas": "El área no tiene franjas ese día.",
    "res.libre": "Libre",
    "res.ocupada": "Ocupada",
    "res.cupos_disponibles": "{n} de {total} cupos libres",
    "res.completo": "Completo",
    "res.cuantas_personas": "¿Cuántas personas van a jugar?",
    "res.cuantas_personas_sub": "Quedan {n} cupo(s) en esta franja.",
    "res.max_por_franja": "Máximo {n} personas por horario",
    "res.para_n_personas": "Para {n} persona(s)",
    "res.comprobante": "Comprobante",
    "res.adjuntar_comprobante": "Adjuntar comprobante",
    "res.cambiar": "Cambiar",
    "res.confirmar_reserva": "¿Confirmar reserva?",
    "res.confirmar_cambio": "¿Cambiar tu reserva?",
    "res.precio": "Precio:",
    "res.si_reservar": "Sí, reservar",
    "res.si_cambiar": "Sí, cambiar",
    "res.volver": "Volver",
    "res.continuar": "Continuar",
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

    // Inicio del portal del cliente
    "inicio.proxima_reserva": "Próxima reserva",
    "inicio.ninguna": "Ninguna",
    "inicio.pendientes": "Pendientes de aprobación",
    "inicio.total_reservas": "Reservas totales",
    "inicio.ir_reservas": "Hacer o ver mis reservas",
    "inicio.ir_instalar": "Instalar la app en tu celular",
    "inicio.areas_disponibles": "Áreas disponibles",

    // Instalar como app (PWA)
    "nav.inicio": "Inicio",
    "pwa.menu": "Instalar la app",
    "pwa.titulo": "Instalá esta app en tu celular",
    "pwa.intro": "Instalá E Cuestas en tu pantalla de inicio para entrar más rápido, con un solo toque — como una app normal.",
    "pwa.intro_android": "Tu navegador puede instalar esta app directamente.",
    "pwa.instalar": "Instalar app",
    "pwa.instalando": "Instalando...",
    "pwa.ya_instalada": "Ya está instalada en este dispositivo.",
    "pwa.paso_ios_1": "Tocá el ícono de Compartir en la barra de Safari.",
    "pwa.paso_ios_2": "Deslizá hacia abajo y tocá \"Agregar a inicio\".",
    "pwa.paso_ios_3": "Confirmá — aparecerá un ícono de E Cuestas en tu pantalla de inicio.",
    "pwa.generico": "Abrí el menú de tu navegador y buscá \"Instalar app\" o \"Agregar a pantalla de inicio\".",
    "pwa.entendido": "Entendido",
    "pwa.push_titulo": "Notificaciones en este dispositivo",
    "pwa.push_intro": "Recibí un aviso del celular apenas cambie el estado de tu reserva, aunque no tengas la página abierta.",
    "pwa.push_activar": "Activar notificaciones",
    "pwa.push_desactivar": "Desactivar en este dispositivo",
    "pwa.push_activado": "Notificaciones activadas en este dispositivo",
    "pwa.push_desactivado": "Notificaciones desactivadas en este dispositivo",
    "pwa.push_denegado": "Bloqueaste los permisos de notificaciones para este sitio. Habilitalos desde la configuración del navegador para activarlas.",
    "pwa.push_no_soportado": "Este navegador no soporta notificaciones push.",

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
    "notif.vaciar": "Clear all",
    "notif.borrar": "Delete",

    "res.titulo": "Reservations",
    "res.hacer_reserva": "Make a reservation",
    "res.mis_reservas": "My reservations",
    "res.sin_areas": "There are no areas available to book right now.",
    "res.sin_reservas": "You don't have any reservations yet. Make your first one above!",
    "res.sin_proximas": "No upcoming reservations. Make one above!",
    "res.historial": "History",
    "res.cambiando": "Changing reservation",
    "res.dia": "Day:",
    "res.cerrar": "Close",
    "res.buscando_horarios": "Looking up available times...",
    "res.sin_franjas": "This area has no time slots that day.",
    "res.libre": "Available",
    "res.ocupada": "Booked",
    "res.cupos_disponibles": "{n} of {total} spots left",
    "res.completo": "Full",
    "res.cuantas_personas": "How many people are playing?",
    "res.cuantas_personas_sub": "{n} spot(s) left in this time slot.",
    "res.max_por_franja": "Max {n} people per time slot",
    "res.para_n_personas": "For {n} people",
    "res.comprobante": "Receipt",
    "res.adjuntar_comprobante": "Attach payment receipt",
    "res.cambiar": "Change",
    "res.confirmar_reserva": "Confirm reservation?",
    "res.confirmar_cambio": "Change your reservation?",
    "res.precio": "Price:",
    "res.si_reservar": "Yes, book it",
    "res.si_cambiar": "Yes, change it",
    "res.volver": "Go back",
    "res.continuar": "Continue",
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

    // Client portal home
    "inicio.proxima_reserva": "Next reservation",
    "inicio.ninguna": "None",
    "inicio.pendientes": "Pending approval",
    "inicio.total_reservas": "Total reservations",
    "inicio.ir_reservas": "Book or view my reservations",
    "inicio.ir_instalar": "Install the app on your phone",
    "inicio.areas_disponibles": "Available areas",

    // Install as app (PWA)
    "nav.inicio": "Home",
    "pwa.menu": "Install as app",
    "pwa.titulo": "Install this app on your phone",
    "pwa.intro": "Install E Cuestas on your home screen for faster, one-tap access — like a regular app.",
    "pwa.intro_android": "Your browser can install this app directly.",
    "pwa.instalar": "Install app",
    "pwa.instalando": "Installing...",
    "pwa.ya_instalada": "Already installed on this device.",
    "pwa.paso_ios_1": "Tap the Share icon in Safari's toolbar.",
    "pwa.paso_ios_2": "Scroll down and tap \"Add to Home Screen\".",
    "pwa.paso_ios_3": "Confirm — an E Cuestas icon will appear on your home screen.",
    "pwa.generico": "Open your browser's menu and look for \"Install app\" or \"Add to Home Screen\".",
    "pwa.entendido": "Got it",
    "pwa.push_titulo": "Notifications on this device",
    "pwa.push_intro": "Get a phone alert as soon as your reservation's status changes, even if you don't have the page open.",
    "pwa.push_activar": "Enable notifications",
    "pwa.push_desactivar": "Disable on this device",
    "pwa.push_activado": "Notifications enabled on this device",
    "pwa.push_desactivado": "Notifications disabled on this device",
    "pwa.push_denegado": "You blocked notification permissions for this site. Enable them from your browser settings to turn this on.",
    "pwa.push_no_soportado": "This browser doesn't support push notifications.",

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
