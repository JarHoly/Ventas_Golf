import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarCheck,
  faSpinner,
  faTrash,
  faPen,
  faPaperclip,
  faFileArrowDown,
  faTriangleExclamation,
  faCircleInfo,
  faUserGroup,
  faClockRotateLeft,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import { apiGet, apiPost, apiPut, apiDelete, apiPostForm, apiGetBlob } from "./api";
import { mostrarError, avisoExito } from "./alertas";
import { useIdioma } from "./i18n";
import { EVENTO_NUEVAS } from "./Notificaciones";
import "./Crud.css";
import "./Reservas.css";

// Debe coincidir con CAPACIDAD_MAX_FRANJA en backend/reservas/models.py.
// Solo se usa acá para el texto informativo ANTES de elegir fecha/franja
// (una vez elegida, el cupo real por franja viene del backend).
const CUPO_MAX = 4;

const fmt = (n) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (iso) => iso.split("-").reverse().join("/");
const horaCorta = (valor) => valor.slice(0, 5);

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Cuántas horas le quedan al cliente para adjuntar el comprobante.
function horasRestantes(creadaEn) {
  const limite = new Date(creadaEn).getTime() + 24 * 3600 * 1000;
  return Math.max(0, Math.round((limite - Date.now()) / 3600000));
}

export default function ReservasCliente() {
  const { t } = useIdioma();
  const [areas, setAreas] = useState([]);
  const [mias, setMias] = useState([]);
  const [cargando, setCargando] = useState(true);

  // El "picker" de franja: para crear (cambiando=null) o cambiar una reserva.
  const [areaElegida, setAreaElegida] = useState(null);
  const [cambiando, setCambiando] = useState(null);

  async function cargar() {
    setCargando(true);
    try {
      const [a, r] = await Promise.all([apiGet("/areas/"), apiGet("/reservas/")]);
      setAreas(a);
      setMias(r);
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // Si llega una notificación nueva (ej. el personal aceptó/rechazó una
    // reserva) mientras estás en esta pantalla, se refresca sola: no hay
    // que salir y volver a entrar para ver el cambio.
    window.addEventListener(EVENTO_NUEVAS, cargar);
    return () => window.removeEventListener(EVENTO_NUEVAS, cargar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmación de borrado TRADUCIDA (alertas.js queda fija en español —
  // la usan también las páginas del personal, que no se tradujeron).
  async function eliminar(reserva) {
    const res = await Swal.fire({
      title: t("res.eliminar_titulo"),
      text: t("res.eliminar_texto"),
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: t("res.eliminar_confirmar"),
      cancelButtonText: t("res.eliminar_cancelar"),
      confirmButtonColor: "#ef4444",
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    try {
      await apiDelete(`/reservas/${reserva.id}/`);
      avisoExito(t("res.eliminada"));
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function verComprobante(reserva) {
    try {
      const blob = await apiGetBlob(`/reservas/${reserva.id}/comprobante/`);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      mostrarError(e.message);
    }
  }

  if (cargando) {
    return (
      <div className="table-card">
        <div className="table-empty">
          <FontAwesomeIcon icon={faSpinner} spin /> ...
        </div>
      </div>
    );
  }

  // Próximas: lo que todavía está por jugarse (y no fue rechazado).
  // Historial: lo que ya pasó o quedó rechazado — registro de solo lectura.
  const hoy = hoyISO();
  const proximas = mias.filter((r) => r.fecha >= hoy && r.estado !== "Rechazada");
  const historial = mias.filter((r) => r.fecha < hoy || r.estado === "Rechazada");

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faCalendarCheck} />
          <h1>{t("res.titulo")}</h1>
        </div>
      </div>

      {/* ===== Hacer una reserva ===== */}
      <h2 className="res-subtitulo">{t("res.hacer_reserva")}</h2>
      {areas.length === 0 ? (
        <div className="table-card">
          <div className="table-empty">{t("res.sin_areas")}</div>
        </div>
      ) : (
        <div className="res-areas">
          {areas.map((a) => (
            <button
              key={a.id}
              className={"res-area-card" + (areaElegida?.id === a.id ? " elegida" : "")}
              onClick={() => {
                setAreaElegida(a);
                setCambiando(null);
              }}
            >
              <span className="res-area-nombre">{a.nombre}</span>
              {a.descripcion && <span className="res-area-desc">{a.descripcion}</span>}
              <span className="res-area-datos">
                ${fmt(a.precio)} · {a.duracion_minutos} {t("res.min")} · {horaCorta(a.hora_apertura)}–{horaCorta(a.hora_cierre)}
              </span>
              <span className="res-area-cupo">
                <FontAwesomeIcon icon={faUserGroup} /> {t("res.max_por_franja", { n: CUPO_MAX })}
              </span>
            </button>
          ))}
        </div>
      )}

      {areaElegida && (
        <SelectorFranja
          area={areaElegida}
          reservaACambiar={cambiando}
          onListo={() => {
            setAreaElegida(null);
            setCambiando(null);
            cargar();
          }}
          onCancelar={() => {
            setAreaElegida(null);
            setCambiando(null);
          }}
        />
      )}

      {/* ===== Mis reservas: próximas + historial ===== */}
      <h2 className="res-subtitulo">{t("res.mis_reservas")}</h2>
      {mias.length === 0 ? (
        <div className="table-card">
          <div className="table-empty">{t("res.sin_reservas")}</div>
        </div>
      ) : (
        <>
          {proximas.length === 0 ? (
            <div className="table-card">
              <div className="table-empty">{t("res.sin_proximas")}</div>
            </div>
          ) : (
            <div className="res-tickets">
              {proximas.map((r) => (
                <TarjetaReserva
                  key={r.id}
                  r={r}
                  onVerComprobante={verComprobante}
                  onSubido={cargar}
                  onCambiar={() => {
                    const area = areas.find((a) => a.id === r.area);
                    if (!area) return mostrarError(t("res.area_no_disponible"));
                    setCambiando(r);
                    setAreaElegida(area);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  onEliminar={() => eliminar(r)}
                />
              ))}
            </div>
          )}

          {historial.length > 0 && (
            <>
              <h2 className="res-subtitulo res-subtitulo-historial">
                <FontAwesomeIcon icon={faClockRotateLeft} /> {t("res.historial")}
              </h2>
              <div className="res-tickets historial">
                {historial.map((r) => (
                  <TarjetaReserva key={r.id} r={r} onVerComprobante={verComprobante} historial />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Una reserva como "boleto": bloque de fecha a la izquierda + franja de color
// según el estado. En "historial" es de solo lectura (sin adjuntar/cambiar/
// eliminar): es un registro de lo que ya pasó.
function TarjetaReserva({ r, onVerComprobante, onSubido, onCambiar, onEliminar, historial = false }) {
  const { t, idioma } = useIdioma();
  const fecha = new Date(`${r.fecha}T00:00:00`);
  const dia = fecha.getDate();
  const mes = fecha.toLocaleDateString(idioma === "en" ? "en-US" : "es-CR", { month: "short" }).replace(".", "");

  return (
    <div className={`res-ticket res-ticket-${r.estado.toLowerCase()}` + (historial ? " historial" : "")}>
      <div className="res-ticket-fecha">
        <span className="res-ticket-dia">{dia}</span>
        <span className="res-ticket-mes">{mes}</span>
      </div>
      <div className="res-ticket-cuerpo">
        <div className="res-ticket-info">
          <span className="res-item-titulo">
            {r.area_nombre} · {horaCorta(r.hora_inicio)}–{horaCorta(r.hora_fin)}
          </span>
          <span className="res-item-sub">
            ${fmt(r.precio)} · {t("res.para_n_personas", { n: r.cantidad_personas })} ·{" "}
            <span className={`res-chip res-${r.estado.toLowerCase()}`}>{t(`estado.${r.estado}`)}</span>
          </span>
          {r.estado === "Rechazada" && r.motivo_rechazo && (
            <span className="res-item-motivo">
              <FontAwesomeIcon icon={faCircleInfo} /> {r.motivo_rechazo}
            </span>
          )}
          {!historial && r.estado === "Pendiente" && !r.tiene_comprobante && (
            <span className={"res-item-aviso" + (r.comprobante_vencido ? " vencido" : "")}>
              <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
              {r.comprobante_vencido
                ? t("res.aviso_vencido")
                : t("res.aviso_adjuntar", { h: horasRestantes(r.creada_en) })}
            </span>
          )}
        </div>
        <div className="res-item-acciones">
          {r.tiene_comprobante ? (
            <button className="btn-ghost" onClick={() => onVerComprobante(r)}>
              <FontAwesomeIcon icon={faFileArrowDown} /> {t("res.comprobante")}
            </button>
          ) : (
            !historial && <SubirComprobante reserva={r} onSubido={onSubido} />
          )}
          {!historial && (
            <>
              <button className="btn-ghost" onClick={onCambiar}>
                <FontAwesomeIcon icon={faPen} /> {t("res.cambiar")}
              </button>
              <button className="btn-icon-danger" title={t("res.eliminar_confirmar")} onClick={onEliminar}>
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Botón que abre el selector de archivo y sube el comprobante.
function SubirComprobante({ reserva, onSubido }) {
  const { t } = useIdioma();
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      await apiPostForm(`/reservas/${reserva.id}/comprobante/`, form);
      avisoExito(t("res.comprobante_adjuntado"));
      onSubido();
    } catch (e2) {
      mostrarError(e2.message);
    } finally {
      setSubiendo(false);
      e.target.value = "";
    }
  }

  return (
    <>
      <button
        className="btn-primary"
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
      >
        <FontAwesomeIcon icon={subiendo ? faSpinner : faPaperclip} spin={subiendo} />{" "}
        {t("res.adjuntar_comprobante")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={subir}
      />
    </>
  );
}

// Fecha + grilla de franjas del área. Sirve para CREAR y para CAMBIAR.
function SelectorFranja({ area, reservaACambiar, onListo, onCancelar }) {
  const { t } = useIdioma();
  const [fecha, setFecha] = useState(reservaACambiar?.fecha || hoyISO());
  const [franjas, setFranjas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      try {
        const data = await apiGet(`/reservas/disponibilidad/?area=${area.id}&fecha=${fecha}`);
        if (!cancelado) setFranjas(data.franjas);
      } catch (e) {
        if (!cancelado) mostrarError(e.message);
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [area.id, fecha]);

  async function elegir(franja) {
    const cupo = franja.cupo_disponible;
    // Paso 1: cuántas personas (acotado al cupo real que queda en la franja).
    const valorInicial = Math.min(reservaACambiar?.cantidad_personas || 1, cupo);
    const { value: cantidad } = await Swal.fire({
      title: t("res.cuantas_personas"),
      html: `<b>${area.nombre}</b><br/>${fechaCorta(fecha)} · ${franja.hora_inicio}–${franja.hora_fin}<br/><span style="color:#64748b">${t("res.cuantas_personas_sub", { n: cupo })}</span>`,
      input: "number",
      inputValue: valorInicial,
      inputAttributes: { min: 1, max: cupo, step: 1 },
      showCancelButton: true,
      confirmButtonText: t("res.continuar"),
      cancelButtonText: t("res.volver"),
      confirmButtonColor: "#0056b3",
      reverseButtons: true,
      inputValidator: (v) => {
        const n = Number(v);
        if (!v || !Number.isInteger(n) || n < 1) return t("res.cuantas_personas");
        if (n > cupo) return t("res.cuantas_personas_sub", { n: cupo });
        return undefined;
      },
    });
    if (!cantidad) return;

    // Paso 2: confirmación final con todos los datos.
    const res = await Swal.fire({
      title: reservaACambiar ? t("res.confirmar_cambio") : t("res.confirmar_reserva"),
      html: `<b>${area.nombre}</b><br/>${fechaCorta(fecha)} · ${franja.hora_inicio}–${franja.hora_fin}<br/>${t("res.para_n_personas", { n: cantidad })}<br/>${t("res.precio")} <b>$${fmt(area.precio)}</b>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: reservaACambiar ? t("res.si_cambiar") : t("res.si_reservar"),
      cancelButtonText: t("res.volver"),
      confirmButtonColor: "#0056b3",
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    try {
      const cuerpo = {
        area: area.id, fecha, hora_inicio: franja.hora_inicio,
        cantidad_personas: Number(cantidad),
      };
      if (reservaACambiar) {
        await apiPut(`/reservas/${reservaACambiar.id}/`, cuerpo);
        avisoExito(t("res.reserva_cambiada"));
      } else {
        await apiPost("/reservas/", cuerpo);
        Swal.fire({
          title: t("res.reserva_creada"),
          html: t("res.reserva_creada_detalle"),
          icon: "success",
          confirmButtonColor: "#0056b3",
        });
      }
      onListo();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  return (
    <div className="res-selector">
      <div className="res-selector-top">
        <b>{area.nombre}</b>
        {reservaACambiar && <span className="res-chip res-pendiente">{t("res.cambiando")}</span>}
        <label className="res-fecha">
          {t("res.dia")}
          <input
            type="date"
            className="form-input"
            min={hoyISO()}
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </label>
        <button className="btn-ghost" onClick={onCancelar}>{t("res.cerrar")}</button>
      </div>

      {cargando ? (
        <div className="table-empty">
          <FontAwesomeIcon icon={faSpinner} spin /> {t("res.buscando_horarios")}
        </div>
      ) : franjas.length === 0 ? (
        <div className="table-empty">{t("res.sin_franjas")}</div>
      ) : (
        (() => {
          // Agrupadas en Mañana/Tarde: una sola lista larga de franjas de
          // 15 min se hace ilegible: partirla ayuda a ubicarse de un vistazo.
          const primeraLibre = franjas.find((f) => f.cupo_disponible > 0)?.hora_inicio;
          const manana = franjas.filter((f) => f.hora_inicio < "12:00");
          const tarde = franjas.filter((f) => f.hora_inicio >= "12:00");
          const grupo = (etiqueta, icono, lista) =>
            lista.length > 0 && (
              <div className="res-franjas-grupo" key={etiqueta}>
                <span className="res-franjas-grupo-titulo">
                  <FontAwesomeIcon icon={icono} /> {etiqueta}
                </span>
                <div className="res-franjas">
                  {lista.map((f) => {
                    const libre = f.cupo_disponible > 0;
                    const parcial = libre && f.cupo_disponible < CUPO_MAX;
                    const esProxima = f.hora_inicio === primeraLibre;
                    return (
                      <button
                        key={f.hora_inicio}
                        className={"res-franja" + (libre ? (parcial ? " parcial" : "") : " ocupada") + (esProxima ? " proxima" : "")}
                        disabled={!libre}
                        onClick={() => elegir(f)}
                      >
                        {esProxima && <span className="res-franja-badge">{t("res.proxima_libre")}</span>}
                        <span className="res-franja-hora">{f.hora_inicio}–{f.hora_fin}</span>
                        <span className="res-franja-cupos">
                          {Array.from({ length: CUPO_MAX }, (_, i) => (
                            <i key={i} className={i < CUPO_MAX - f.cupo_disponible ? "ocupado" : ""} />
                          ))}
                        </span>
                        <span>
                          {libre ? t("res.cupos_disponibles", { n: f.cupo_disponible, total: CUPO_MAX }) : t("res.completo")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          return (
            <>
              {grupo(t("res.manana"), faSun, manana)}
              {grupo(t("res.tarde"), faMoon, tarde)}
            </>
          );
        })()
      )}
    </div>
  );
}
