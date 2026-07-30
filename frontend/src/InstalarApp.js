import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMobileScreenButton,
  faShareFromSquare,
  faSquarePlus,
  faDownload,
  faCircleCheck,
  faBell,
  faBellSlash,
} from "@fortawesome/free-solid-svg-icons";
import { useIdioma } from "./i18n";
import { mostrarError, avisoExito } from "./alertas";
import {
  pushDisponible,
  permisoDenegado,
  estaSuscrito,
  activarPush,
  desactivarPush,
} from "./push";
import "./InstalarApp.css";

// El navegador dispara este evento UNA vez por sesión, antes de que el
// usuario abra el tutorial. Se guarda en una variable de módulo (no en
// estado de React) porque el evento puede llegar mucho antes de que se
// monte el componente que lo necesita.
let promptDiferido = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptDiferido = e;
  });
}

function esIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

function yaInstalada() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// ----- Persistencia de "ya vio el tutorial", por usuario -----
const clave = (usuario) => `pwa_tutorial_visto_${usuario}`;

export function tutorialYaVisto(usuario) {
  return Boolean(usuario) && localStorage.getItem(clave(usuario)) === "1";
}

export function marcarTutorialVisto(usuario) {
  if (usuario) localStorage.setItem(clave(usuario), "1");
}

// ===== Contenido del tutorial (se usa igual en el modal y en la sección fija) =====
export function InstalarAppContenido() {
  const { t } = useIdioma();
  const [instalando, setInstalando] = useState(false);
  const [instalada, setInstalada] = useState(yaInstalada());
  const [hayPrompt, setHayPrompt] = useState(Boolean(promptDiferido));

  // Si el evento llega DESPUÉS de montar este componente, lo detectamos igual.
  useEffect(() => {
    function onPrompt() {
      setHayPrompt(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function instalar() {
    if (!promptDiferido) return;
    setInstalando(true);
    promptDiferido.prompt();
    const eleccion = await promptDiferido.userChoice;
    setInstalando(false);
    if (eleccion.outcome === "accepted") setInstalada(true);
    promptDiferido = null;
    setHayPrompt(false);
  }

  if (instalada) {
    return (
      <div className="pwa-ok">
        <FontAwesomeIcon icon={faCircleCheck} /> {t("pwa.ya_instalada")}
      </div>
    );
  }

  if (esIOS()) {
    return (
      <ol className="pwa-pasos">
        <li>
          <FontAwesomeIcon icon={faShareFromSquare} className="pwa-paso-icono" />
          {t("pwa.paso_ios_1")}
        </li>
        <li>
          <FontAwesomeIcon icon={faSquarePlus} className="pwa-paso-icono" />
          {t("pwa.paso_ios_2")}
        </li>
        <li>{t("pwa.paso_ios_3")}</li>
      </ol>
    );
  }

  if (hayPrompt) {
    return (
      <div className="pwa-instalar-android">
        <p>{t("pwa.intro_android")}</p>
        <button className="btn-primary" onClick={instalar} disabled={instalando}>
          <FontAwesomeIcon icon={faDownload} /> {instalando ? t("pwa.instalando") : t("pwa.instalar")}
        </button>
      </div>
    );
  }

  return <p className="pwa-generico">{t("pwa.generico")}</p>;
}

// ===== Activar/desactivar notificaciones push nativas en ESTE dispositivo =====
export function NotificacionesPush() {
  const { t } = useIdioma();
  const [suscrito, setSuscrito] = useState(null); // null = todavía no se sabe
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    estaSuscrito().then(setSuscrito).catch(() => setSuscrito(false));
  }, []);

  async function activar() {
    setCargando(true);
    try {
      await activarPush();
      setSuscrito(true);
      avisoExito(t("pwa.push_activado"));
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  async function desactivar() {
    setCargando(true);
    try {
      await desactivarPush();
      setSuscrito(false);
      avisoExito(t("pwa.push_desactivado"));
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  if (!pushDisponible()) {
    return (
      <div className="pwa-push">
        <p className="pwa-generico">{t("pwa.push_no_soportado")}</p>
      </div>
    );
  }

  return (
    <div className="pwa-push">
      <h3 className="pwa-push-titulo">
        <FontAwesomeIcon icon={faBell} /> {t("pwa.push_titulo")}
      </h3>
      <p className="form-hint" style={{ marginTop: 0 }}>{t("pwa.push_intro")}</p>
      {permisoDenegado() ? (
        <p className="pwa-push-denegado">
          <FontAwesomeIcon icon={faBellSlash} /> {t("pwa.push_denegado")}
        </p>
      ) : suscrito ? (
        <button className="btn-secondary" onClick={desactivar} disabled={cargando}>
          <FontAwesomeIcon icon={faBellSlash} /> {cargando ? "..." : t("pwa.push_desactivar")}
        </button>
      ) : (
        <button className="btn-primary" onClick={activar} disabled={cargando || suscrito === null}>
          <FontAwesomeIcon icon={faBell} /> {cargando ? "..." : t("pwa.push_activar")}
        </button>
      )}
    </div>
  );
}

// ===== Modal — se muestra automáticamente una vez, después del primer login =====
export function InstalarAppModal({ onClose }) {
  const { t } = useIdioma();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          <FontAwesomeIcon icon={faMobileScreenButton} /> {t("pwa.titulo")}
        </h2>
        <p className="form-hint">{t("pwa.intro")}</p>
        <InstalarAppContenido />
        <NotificacionesPush />
        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>
            {t("pwa.entendido")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Sección fija del sidebar — el mismo tutorial, siempre disponible =====
export function InstalarAppSeccion() {
  const { t } = useIdioma();
  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faMobileScreenButton} />
          <h1>{t("pwa.titulo")}</h1>
        </div>
      </div>
      <div className="table-card" style={{ padding: 20 }}>
        <p className="form-hint" style={{ marginTop: 0 }}>{t("pwa.intro")}</p>
        <InstalarAppContenido />
        <NotificacionesPush />
      </div>
    </div>
  );
}
