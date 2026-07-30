import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faTrash, faBroom } from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import { apiGet, apiPost, apiDelete } from "./api";
import { confirmarEliminar } from "./alertas";
import { useIdioma } from "./i18n";
import "./Reservas.css";

const CADA_MS = 20000; // consultar cada 20s: se nota mucho más rápido que antes

// Evento global: cualquier pantalla (ej. Mis Reservas) puede escucharlo para
// refrescarse sola cuando llega una notificación nueva, sin acoplarse a este
// componente. window.addEventListener("notificaciones:nuevas", fn).
export const EVENTO_NUEVAS = "notificaciones:nuevas";

// Campanita del navbar: badge con no-leídas + lista desplegable.
export default function Notificaciones() {
  const { idioma, t } = useIdioma();
  const [noLeidas, setNoLeidas] = useState(0);
  const [lista, setLista] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  // Guarda el id más alto visto hasta ahora, para detectar SOLO lo nuevo
  // entre un sondeo y el siguiente (y no repetir el toast con lo ya visto).
  const ultimoIdVisto = useRef(null);

  async function cargar() {
    try {
      const data = await apiGet("/notificaciones/");
      setNoLeidas(data.no_leidas);
      setLista(data.notificaciones);

      const maxId = data.notificaciones.reduce((m, n) => Math.max(m, n.id), 0);
      if (ultimoIdVisto.current !== null && maxId > ultimoIdVisto.current) {
        const nuevas = data.notificaciones.filter((n) => n.id > ultimoIdVisto.current);
        // Toast visible aunque el usuario no esté mirando la campanita.
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "info",
          title: nuevas.length === 1 ? nuevas[0].mensaje : `${nuevas.length} notificaciones nuevas`,
          showConfirmButton: false,
          timer: 5000,
          timerProgressBar: true,
        });
        // Avisa a quien esté escuchando (ej. Mis Reservas) que refresque.
        window.dispatchEvent(new CustomEvent(EVENTO_NUEVAS, { detail: nuevas }));
      }
      ultimoIdVisto.current = maxId;
    } catch {
      // silencioso: la campanita nunca debe romper el dashboard
    }
  }

  useEffect(() => {
    cargar();
    const timer = setInterval(cargar, CADA_MS);
    // El navegador PAUSA (o alarga mucho) los setInterval de una pestaña en
    // segundo plano: si el personal acepta una reserva mientras el cliente
    // tiene la pestaña de fondo, el sondeo puede tardar minutos en notarlo.
    // Por eso, además del sondeo, se refresca YA apenas la pestaña vuelve a
    // primer plano o la ventana recupera el foco.
    function alVolver() {
      if (document.visibilityState === "visible") cargar();
    }
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    function clicFuera(e) {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", clicFuera);
    return () => document.removeEventListener("mousedown", clicFuera);
  }, []);

  async function abrir() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    // Al abrir, todo pasa a leído (el badge se apaga).
    if (nuevo && noLeidas > 0) {
      try {
        await apiPost("/notificaciones/leidas/", {});
        setNoLeidas(0);
      } catch {
        // sin drama: quedará para el próximo intento
      }
    }
  }

  async function borrar(id) {
    const anterior = lista;
    setLista((l) => l.filter((n) => n.id !== id)); // optimista: se siente instantáneo
    try {
      await apiDelete(`/notificaciones/${id}/`);
    } catch {
      setLista(anterior); // si falló, se restaura
    }
  }

  async function vaciarTodas() {
    if (!(await confirmarEliminar("todas tus notificaciones"))) return;
    const anterior = lista;
    setLista([]);
    try {
      await apiDelete("/notificaciones/vaciar/");
    } catch {
      setLista(anterior);
    }
  }

  return (
    <div className="notif-box" ref={caja}>
      <button className="notif-btn" onClick={abrir} title="Notificaciones">
        <FontAwesomeIcon icon={faBell} />
        {noLeidas > 0 && (
          <span className="notif-badge">{noLeidas > 9 ? "9+" : noLeidas}</span>
        )}
      </button>

      {abierto && (
        <div className="notif-panel">
          <div className="notif-titulo">
            {t("notif.titulo")}
            {lista.length > 0 && (
              <button className="notif-vaciar" onClick={vaciarTodas} title={t("notif.vaciar")}>
                <FontAwesomeIcon icon={faBroom} /> {t("notif.vaciar")}
              </button>
            )}
          </div>
          {lista.length === 0 ? (
            <div className="notif-vacia">{t("notif.vacia")}</div>
          ) : (
            lista.map((n) => (
              <div key={n.id} className={"notif-item" + (n.leida ? "" : " nueva")}>
                <button className="notif-borrar" onClick={() => borrar(n.id)} title={t("notif.borrar")}>
                  <FontAwesomeIcon icon={faTrash} />
                </button>
                {/* El TEXTO del mensaje lo arma el backend en español (queda
                    pendiente traducirlo del lado del servidor). */}
                <p>{n.mensaje}</p>
                <span>
                  {new Date(n.creada_en).toLocaleString(idioma === "en" ? "en-US" : "es-CR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
