import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { apiGet, apiPost } from "./api";
import { useIdioma } from "./i18n";
import "./Reservas.css";

const CADA_MS = 60000; // consultar cada minuto

// Campanita del navbar: badge con no-leídas + lista desplegable.
export default function Notificaciones() {
  const { idioma, t } = useIdioma();
  const [noLeidas, setNoLeidas] = useState(0);
  const [lista, setLista] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);

  async function cargar() {
    try {
      const data = await apiGet("/notificaciones/");
      setNoLeidas(data.no_leidas);
      setLista(data.notificaciones);
    } catch {
      // silencioso: la campanita nunca debe romper el dashboard
    }
  }

  useEffect(() => {
    cargar();
    const timer = setInterval(cargar, CADA_MS);
    return () => clearInterval(timer);
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
          <div className="notif-titulo">{t("notif.titulo")}</div>
          {lista.length === 0 ? (
            <div className="notif-vacia">{t("notif.vacia")}</div>
          ) : (
            lista.map((n) => (
              <div key={n.id} className={"notif-item" + (n.leida ? "" : " nueva")}>
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
