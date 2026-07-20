import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarCheck,
  faPlus,
  faPen,
  faTrash,
  faSpinner,
  faCheck,
  faXmark,
  faFileArrowDown,
  faUserPlus,
  faKey,
  faTriangleExclamation,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import { apiGet, apiPost, apiPut, apiDelete, apiGetBlob, esAdmin } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import SearchableSelect from "./SearchableSelect";
import "./Crud.css";
import "./Reservas.css";

const fmt = (n) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fechaCorta = (iso) => iso.split("-").reverse().join("/");
const hora = (t) => t.slice(0, 5); // "06:00:00" -> "06:00"

export default function ReservasStaff() {
  const [tab, setTab] = useState("reservas");

  // La pestaña de Personal (Admin/Operativo) es delicada: solo Admin.
  const tabs = [
    ["reservas", "Reservas"],
    ["areas", "Áreas"],
    ["cuentas", "Cuentas de clientes"],
    ...(esAdmin() ? [["personal", "Personal"]] : []),
  ];

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faCalendarCheck} />
          <h1>Reservas</h1>
        </div>
      </div>

      <div className="res-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={"res-tab" + (tab === id ? " activo" : "")}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "reservas" && <TabReservas />}
      {tab === "areas" && <TabAreas />}
      {tab === "cuentas" && <TabCuentas />}
      {tab === "personal" && esAdmin() && <TabPersonal />}
    </div>
  );
}

// ===================== TAB: RESERVAS =====================
function TabReservas() {
  const [estado, setEstado] = useState("Pendiente");
  const [fecha, setFecha] = useState("");
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (estado) params.set("estado", estado);
      if (fecha) params.set("fecha", fecha);
      setItems(await apiGet(`/reservas/?${params}`));
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, fecha]);

  async function decidir(reserva, nuevoEstado) {
    let motivo = "";
    if (nuevoEstado === "Rechazada") {
      const res = await Swal.fire({
        title: "Rechazar reserva",
        input: "text",
        inputLabel: "Motivo (el cliente lo verá en su notificación)",
        showCancelButton: true,
        confirmButtonText: "Rechazar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#d62828",
      });
      if (!res.isConfirmed) return;
      motivo = res.value || "";
    }
    try {
      await apiPost(`/reservas/${reserva.id}/estado/`, { estado: nuevoEstado, motivo });
      avisoExito(`Reserva ${nuevoEstado.toLowerCase()}`);
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

  async function eliminar(reserva) {
    if (!(await confirmarEliminar("esta reserva (el cliente será notificado)"))) return;
    try {
      await apiDelete(`/reservas/${reserva.id}/`);
      avisoExito("Reserva cancelada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  return (
    <>
      <div className="res-filtros">
        <select className="form-input" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option>Pendiente</option>
          <option>Aceptada</option>
          <option>Rechazada</option>
        </select>
        <input
          type="date"
          className="form-input"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        {fecha && (
          <button className="btn-ghost" onClick={() => setFecha("")}>
            Todas las fechas
          </button>
        )}
      </div>

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : items.length === 0 ? (
          <div className="table-empty">No hay reservas con esos filtros.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Área</th>
                <th>Fecha</th>
                <th>Horario</th>
                <th>Precio</th>
                <th>Comprobante</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.cliente_nombre}</td>
                  <td>{r.area_nombre}</td>
                  <td>{fechaCorta(r.fecha)}</td>
                  <td>{hora(r.hora_inicio)} – {hora(r.hora_fin)}</td>
                  <td>${fmt(r.precio)}</td>
                  <td>
                    {r.tiene_comprobante ? (
                      <button className="btn-ghost" onClick={() => verComprobante(r)}>
                        <FontAwesomeIcon icon={faFileArrowDown} /> Ver
                      </button>
                    ) : r.comprobante_vencido ? (
                      <span className="res-chip res-chip-alerta" title="Pasaron 24h sin comprobante">
                        <FontAwesomeIcon icon={faTriangleExclamation} /> Posible inválida
                      </span>
                    ) : (
                      <span className="res-sin">Sin adjuntar</span>
                    )}
                  </td>
                  <td>
                    <span className={`res-chip res-${r.estado.toLowerCase()}`}>{r.estado}</span>
                    {r.estado === "Rechazada" && r.motivo_rechazo && (
                      <span className="res-motivo" title={r.motivo_rechazo}> ⓘ</span>
                    )}
                  </td>
                  <td>
                    {r.estado !== "Aceptada" && (
                      <button
                        className="btn-icon-ok"
                        title="Aceptar"
                        onClick={() => decidir(r, "Aceptada")}
                      >
                        <FontAwesomeIcon icon={faCheck} />
                      </button>
                    )}
                    {r.estado !== "Rechazada" && (
                      <button
                        className="btn-icon-danger"
                        title="Rechazar"
                        onClick={() => decidir(r, "Rechazada")}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    )}
                    <button className="btn-icon-danger" title="Cancelar/eliminar" onClick={() => eliminar(r)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ===================== TAB: ÁREAS =====================
function TabAreas() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [enEdicion, setEnEdicion] = useState(null);

  async function cargar() {
    setCargando(true);
    try {
      setItems(await apiGet("/areas/"));
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function eliminar(area) {
    if (!(await confirmarEliminar(`el área "${area.nombre}"`))) return;
    try {
      await apiDelete(`/areas/${area.id}/`);
      avisoExito("Área eliminada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  return (
    <>
      <div className="res-filtros">
        <span className="res-hint">
          Las áreas son lo que el cliente reserva (campos, driving range...). Desactivar
          un área la esconde del portal sin borrar su historial.
        </span>
        <button className="btn-primary" onClick={() => setEnEdicion({})}>
          <FontAwesomeIcon icon={faPlus} /> Agregar área
        </button>
      </div>

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : items.length === 0 ? (
          <div className="table-empty">Todavía no hay áreas. Agregá la primera.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Precio (USD)</th>
                <th>Bloque</th>
                <th>Horario</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.nombre}</td>
                  <td>${fmt(a.precio)}</td>
                  <td>{a.duracion_minutos} min</td>
                  <td>{hora(a.hora_apertura)} – {hora(a.hora_cierre)}</td>
                  <td>
                    <span className={"res-chip " + (a.activa ? "res-aceptada" : "res-inactiva")}>
                      {a.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon-edit" title="Editar" onClick={() => setEnEdicion(a)}>
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                    <button className="btn-icon-danger" title="Eliminar" onClick={() => eliminar(a)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {enEdicion !== null && (
        <AreaForm
          existente={enEdicion.id ? enEdicion : null}
          onClose={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            cargar();
          }}
        />
      )}
    </>
  );
}

function AreaForm({ existente, onClose, onGuardado }) {
  const editando = Boolean(existente);
  const [form, setForm] = useState({
    nombre: existente?.nombre || "",
    descripcion: existente?.descripcion || "",
    precio: existente?.precio || "",
    duracion_minutos: existente?.duracion_minutos || 60,
    hora_apertura: existente ? hora(existente.hora_apertura) : "06:00",
    hora_cierre: existente ? hora(existente.hora_cierre) : "18:00",
    activa: existente ? existente.activa : true,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const campo = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      if (editando) await apiPut(`/areas/${existente.id}/`, form);
      else await apiPost("/areas/", form);
      avisoExito(editando ? "Área actualizada" : "Área creada");
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{editando ? "Editar área" : "Nueva área"}</h2>
        {error && <div className="alert-error">{error}</div>}
        <form onSubmit={guardar}>
          <label className="form-label">Nombre</label>
          <input className="form-input" value={form.nombre} onChange={campo("nombre")} required autoFocus />

          <label className="form-label">Descripción (el cliente la ve)</label>
          <input className="form-input" value={form.descripcion} onChange={campo("descripcion")} placeholder="Ej: Campo de 18 hoyos, incluye carrito" />

          <div className="fila-2">
            <div>
              <label className="form-label">Precio por bloque ($)</label>
              <input type="number" step="0.01" min="0" className="form-input" value={form.precio} onChange={campo("precio")} required />
            </div>
            <div>
              <label className="form-label">Duración del bloque (min)</label>
              <input type="number" min="15" step="15" className="form-input" value={form.duracion_minutos} onChange={campo("duracion_minutos")} required />
            </div>
          </div>

          <div className="fila-2">
            <div>
              <label className="form-label">Abre a las</label>
              <input type="time" className="form-input" value={form.hora_apertura} onChange={campo("hora_apertura")} required />
            </div>
            <div>
              <label className="form-label">Cierra a las</label>
              <input type="time" className="form-input" value={form.hora_cierre} onChange={campo("hora_cierre")} required />
            </div>
          </div>

          <label className="remember">
            <input type="checkbox" checked={form.activa} onChange={campo("activa")} />
            Área activa (visible para los clientes)
          </label>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===================== TAB: CUENTAS DE CLIENTES =====================
function TabCuentas() {
  const [items, setItems] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const [cuentas, pers] = await Promise.all([
        apiGet("/cuentas-clientes/"),
        apiGet("/personas/?tipo=Cliente"),
      ]);
      setItems(cuentas);
      setPersonas(pers);
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function alternarActivo(cuenta) {
    try {
      await apiPut(`/cuentas-clientes/${cuenta.id}/`, { activo: !cuenta.activo });
      avisoExito(cuenta.activo ? "Cuenta desactivada" : "Cuenta activada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function nuevaClave(cuenta) {
    const res = await Swal.fire({
      title: `Nueva clave para ${cuenta.username}`,
      input: "text",
      inputLabel: "Mínimo 6 caracteres. Entregásela al cliente.",
      showCancelButton: true,
      confirmButtonText: "Cambiar clave",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#0056b3",
    });
    if (!res.isConfirmed || !res.value) return;
    try {
      await apiPut(`/cuentas-clientes/${cuenta.id}/`, { password: res.value });
      avisoExito("Clave actualizada");
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function eliminar(cuenta) {
    if (!(await confirmarEliminar(`la cuenta "${cuenta.username}"`))) return;
    try {
      await apiDelete(`/cuentas-clientes/${cuenta.id}/`);
      avisoExito("Cuenta eliminada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  return (
    <>
      <div className="res-filtros">
        <span className="res-hint">
          Con estas cuentas los clientes entran al portal de reservas (no ven nada
          del negocio). Creá la cuenta y entregale usuario y clave al cliente.
        </span>
        <button className="btn-primary" onClick={() => setCreando(true)}>
          <FontAwesomeIcon icon={faUserPlus} /> Crear cuenta
        </button>
      </div>

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : items.length === 0 ? (
          <div className="table-empty">Todavía no hay cuentas de clientes.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Ficha de cliente</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="codigo-cell">{c.username}</td>
                  <td>{c.nombre}</td>
                  <td>{c.persona_nombre || <span className="res-sin">Sin asociar</span>}</td>
                  <td>
                    <span className={"res-chip " + (c.activo ? "res-aceptada" : "res-inactiva")}>
                      {c.activo ? "Activa" : "Desactivada"}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon-edit" title="Cambiar clave" onClick={() => nuevaClave(c)}>
                      <FontAwesomeIcon icon={faKey} />
                    </button>
                    <button
                      className={c.activo ? "btn-icon-danger" : "btn-icon-ok"}
                      title={c.activo ? "Desactivar" : "Activar"}
                      onClick={() => alternarActivo(c)}
                    >
                      <FontAwesomeIcon icon={c.activo ? faXmark : faCheck} />
                    </button>
                    <button className="btn-icon-danger" title="Eliminar cuenta" onClick={() => eliminar(c)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creando && (
        <CuentaForm
          personas={personas}
          onClose={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            cargar();
          }}
        />
      )}
    </>
  );
}

function CuentaForm({ personas, onClose, onGuardado }) {
  const [username, setUsername] = useState("");
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [persona, setPersona] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const opciones = personas.map((p) => ({ id: p.id, label: `${p.codigo} · ${p.nombre}` }));

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await apiPost("/cuentas-clientes/", {
        username: username.trim(),
        nombre: nombre.trim(),
        password,
        persona: persona || null,
      });
      avisoExito("Cuenta creada");
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Nueva cuenta de cliente</h2>
        {error && <div className="alert-error">{error}</div>}
        <form onSubmit={guardar}>
          <label className="form-label">Usuario (para entrar al sistema)</label>
          <input className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />

          <label className="form-label">Nombre del cliente</label>
          <input className="form-input" value={nombre} onChange={(e) => setNombre(e.target.value)} />

          <label className="form-label">Clave (mínimo 6 caracteres)</label>
          <input className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <p className="form-hint">Entregale el usuario y la clave al cliente.</p>

          <label className="form-label">Ficha de cliente (opcional)</label>
          <SearchableSelect
            opciones={opciones}
            valor={persona}
            onChange={setPersona}
            placeholder="Buscar en Clientes (CRxxxx)..."
          />

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? "Creando..." : "Crear cuenta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===================== TAB: PERSONAL (Admin/Operativo) — solo Admin =====================
// Las cuentas de Admin y Operativo se crean por ahora desde el admin de
// Django (/admin/) o "manage.py createsuperuser"; acá solo se gestiona
// quién sigue activo en el sistema.
function TabPersonal() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    try {
      setItems(await apiGet("/usuarios-personal/"));
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function eliminar(u) {
    if (!(await confirmarEliminar(`la cuenta "${u.username}" (${u.rol})`))) return;
    try {
      await apiDelete(`/usuarios-personal/${u.id}/`);
      avisoExito("Cuenta eliminada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  return (
    <>
      <div className="res-filtros">
        <span className="res-hint">
          Cuentas de Admin y Operativo. Se crean desde el panel de Django
          (/admin/); acá se puede eliminar a quien ya no trabaje en el negocio.
        </span>
      </div>

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : items.length === 0 ? (
          <div className="table-empty">No hay cuentas de personal.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td className="codigo-cell">
                    {u.username} {u.soy_yo && <span className="res-sin">(vos)</span>}
                  </td>
                  <td>{u.nombre}</td>
                  <td>
                    <span className={"res-chip " + (u.rol === "Admin" ? "res-aceptada" : "res-pendiente")}>
                      <FontAwesomeIcon icon={faUserShield} /> {u.rol}
                    </span>
                  </td>
                  <td>
                    <span className={"res-chip " + (u.activo ? "res-aceptada" : "res-inactiva")}>
                      {u.activo ? "Activa" : "Desactivada"}
                    </span>
                  </td>
                  <td>
                    {u.soy_yo ? (
                      <span className="res-sin">No podés eliminar tu propia cuenta</span>
                    ) : (
                      <button className="btn-icon-danger" title="Eliminar" onClick={() => eliminar(u)}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
