import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHandSparkles,
  faCalendarCheck,
  faClock,
  faCircleCheck,
  faMobileScreenButton,
  faArrowRight,
} from "@fortawesome/free-solid-svg-icons";
import { apiGet } from "./api";
import { useIdioma } from "./i18n";
import "./Crud.css";
import "./Reservas.css";
import "./ClienteInicio.css";

const fmt = (n) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (iso) => iso.split("-").reverse().join("/");
const horaCorta = (v) => v.slice(0, 5);

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Página de bienvenida del portal del cliente: un vistazo rápido a su
// próxima reserva y accesos directos, en vez de aterrizar directo en la
// lista de "Mis Reservas" (que antes era la única pantalla que existía).
export default function ClienteInicio({ onIrA }) {
  const { idioma, t } = useIdioma();
  const [areas, setAreas] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const nombre = localStorage.getItem("nombre") || sessionStorage.getItem("nombre") || "";

  useEffect(() => {
    Promise.all([apiGet("/areas/"), apiGet("/reservas/")])
      .then(([a, r]) => {
        setAreas(a);
        setReservas(r);
      })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  const hoy = hoyISO();
  const proxima = reservas
    .filter((r) => r.estado !== "Rechazada" && r.fecha >= hoy)
    .sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio))[0];
  const pendientes = reservas.filter((r) => r.estado === "Pendiente").length;

  return (
    <div>
      <div className="cli-hero">
        <FontAwesomeIcon icon={faHandSparkles} className="cli-hero-icono" />
        <div>
          <h1 className="cli-hero-titulo">{idioma === "en" ? "Hi" : "¡Hola"}{nombre ? `, ${nombre}` : ""}!</h1>
          <p className="cli-hero-sub">
            {new Date().toLocaleDateString(idioma === "en" ? "en-US" : "es-CR", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="cli-stats">
        <div className="cli-stat">
          <FontAwesomeIcon icon={faCalendarCheck} className="cli-stat-icono azul" />
          <div>
            <span className="cli-stat-label">{t("inicio.proxima_reserva")}</span>
            <span className="cli-stat-valor">
              {cargando ? "..." : proxima ? `${fechaCorta(proxima.fecha)} · ${horaCorta(proxima.hora_inicio)}` : t("inicio.ninguna")}
            </span>
          </div>
        </div>
        <div className="cli-stat">
          <FontAwesomeIcon icon={faClock} className="cli-stat-icono ambar" />
          <div>
            <span className="cli-stat-label">{t("inicio.pendientes")}</span>
            <span className="cli-stat-valor">{cargando ? "..." : pendientes}</span>
          </div>
        </div>
        <div className="cli-stat">
          <FontAwesomeIcon icon={faCircleCheck} className="cli-stat-icono verde" />
          <div>
            <span className="cli-stat-label">{t("inicio.total_reservas")}</span>
            <span className="cli-stat-valor">{cargando ? "..." : reservas.length}</span>
          </div>
        </div>
      </div>

      <div className="cli-accesos">
        <button className="cli-acceso" onClick={() => onIrA("reservas-cliente")}>
          <span>
            <FontAwesomeIcon icon={faCalendarCheck} /> {t("inicio.ir_reservas")}
          </span>
          <FontAwesomeIcon icon={faArrowRight} />
        </button>
        <button className="cli-acceso" onClick={() => onIrA("instalar-app")}>
          <span>
            <FontAwesomeIcon icon={faMobileScreenButton} /> {t("inicio.ir_instalar")}
          </span>
          <FontAwesomeIcon icon={faArrowRight} />
        </button>
      </div>

      {areas.length > 0 && (
        <>
          <h2 className="res-subtitulo">{t("inicio.areas_disponibles")}</h2>
          <div className="res-areas">
            {areas.map((a) => (
              <button key={a.id} className="res-area-card" onClick={() => onIrA("reservas-cliente")}>
                <span className="res-area-nombre">{a.nombre}</span>
                {a.descripcion && <span className="res-area-desc">{a.descripcion}</span>}
                <span className="res-area-datos">
                  ${fmt(a.precio)} · {a.duracion_minutos} min · {horaCorta(a.hora_apertura)}–{horaCorta(a.hora_cierre)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
