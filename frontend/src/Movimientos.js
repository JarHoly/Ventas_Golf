import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMoneyBillTransfer,
  faPlus,
  faTrash,
  faPen,
  faSpinner,
  faFilter,
  faFilePdf,
  faLock,
  faLockOpen,
  faFlagCheckered,
  faNoteSticky,
} from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import { apiGet, apiPost, apiPut, apiDelete, apiGetBlob, esAdmin } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import SearchableSelect from "./SearchableSelect";
import "./Crud.css";
import "./Movimientos.css";

const METODOS = ["Efectivo", "Tarjeta", "Sinpe", "Transferencia"];

// Formatea 1500 -> "1,500.00"
const fmt = (n) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Los montos de un gasto se muestran en rojo y entre paréntesis (estilo contable).
function Monto({ valor, gasto }) {
  return (
    <span className={gasto ? "monto-gasto" : ""}>
      {gasto ? `(${fmt(valor)})` : fmt(valor)}
    </span>
  );
}

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const FILTROS_VACIOS = { persona: "", producto: "", metodo: "", categoria: "", montoMin: "", montoMax: "" };

export default function Movimientos() {
  const [fecha, setFecha] = useState(hoy());
  const [movs, setMovs] = useState([]);
  const [cerrado, setCerrado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Catálogos para los selects con búsqueda (se cargan una vez).
  const [personas, setPersonas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);

  const [modalAgregar, setModalAgregar] = useState(false); // el modal "pegajoso"
  const [enEdicion, setEnEdicion] = useState(null);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);

  // Observaciones del día (salen impresas en el PDF; solo admin las edita).
  const [obs, setObs] = useState({ texto: "", actualizado_en: null, actualizado_por: null });
  const [modalObs, setModalObs] = useState(false);

  // Cargar catálogos una sola vez.
  useEffect(() => {
    Promise.all([apiGet("/personas/"), apiGet("/productos/"), apiGet("/categorias/")])
      .then(([per, pro, cat]) => {
        setPersonas(per);
        setProductos(pro);
        setCategorias(cat);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Cargar los movimientos y el estado del día cada vez que cambia la fecha.
  async function cargarDia(f = fecha) {
    setCargando(true);
    setError("");
    try {
      const [lista, estado, observacion] = await Promise.all([
        apiGet(`/movimientos/?fecha=${f}`),
        apiGet(`/dias/${f}/`),
        apiGet(`/dias/${f}/observacion/`),
      ]);
      setMovs(lista);
      setCerrado(estado.cerrado);
      setObs(observacion);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarDia(fecha);
    setModalAgregar(false);
    setEnEdicion(null);
    setFiltros(FILTROS_VACIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  async function eliminar(id) {
    if (!(await confirmarEliminar("este movimiento"))) return;
    try {
      await apiDelete(`/movimientos/${id}/`);
      avisoExito("Movimiento eliminado");
      cargarDia(); // recarga con los números ya recalculados por el backend
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function terminarDia() {
    const res = await Swal.fire({
      title: "¿Terminar el día?",
      html: `Se cerrará el <b>${fecha.split("-").reverse().join("/")}</b>.<br/>Ya no se podrán agregar ni modificar movimientos.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, terminar el día",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#0056b3",
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    try {
      await apiPost(`/dias/${fecha}/`, {});
      avisoExito("Día terminado");
      cargarDia();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function reabrirDia() {
    const res = await Swal.fire({
      title: "¿Reabrir el día?",
      text: "Se podrá volver a modificar. Requiere permisos de administrador.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Reabrir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#0056b3",
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    try {
      await apiDelete(`/dias/${fecha}/`);
      avisoExito("Día reabierto");
      cargarDia();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  async function verPdf() {
    try {
      const blob = await apiGetBlob(`/reportes/dia/${fecha}/pdf/`);
      // Se abre en otra pestaña: desde ahí se puede imprimir o descargar.
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      mostrarError(e.message);
    }
  }

  // ---------- Filtros avanzados (sobre la lista ya cargada) ----------
  const visibles = movs.filter((m) => {
    if (filtros.persona && String(m.persona) !== String(filtros.persona)) return false;
    if (filtros.producto && String(m.producto) !== String(filtros.producto)) return false;
    if (filtros.metodo && m.metodo !== filtros.metodo) return false;
    if (filtros.categoria && String(m.categoria_id) !== String(filtros.categoria)) return false;
    if (filtros.montoMin !== "" && Number(m.total) < Number(filtros.montoMin)) return false;
    if (filtros.montoMax !== "" && Number(m.total) > Number(filtros.montoMax)) return false;
    return true;
  });
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS);

  // Totales del día (sobre lo visible).
  const totalVentas = visibles.filter((m) => m.tipo === "Venta").reduce((s, m) => s + Number(m.total), 0);
  const totalGastos = visibles.filter((m) => m.tipo === "Gasto").reduce((s, m) => s + Number(m.total), 0);

  // Etiquetas para los selects con búsqueda.
  const opcionesPersona = personas.map((p) => ({ id: p.id, label: `${p.codigo} · ${p.nombre} (${p.tipo})` }));
  const opcionesProducto = productos.map((p) => ({ id: p.id, label: `${p.nombre} — $${fmt(p.precio_unitario)}` }));

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faMoneyBillTransfer} />
          <h1>Movimientos Diarios</h1>
        </div>
        <div className="page-actions">
          {cerrado ? (
            <>
              <span className="chip-cerrado">
                <FontAwesomeIcon icon={faLock} /> Día terminado
              </span>
              <button className="btn-secondary btn-wide" onClick={verPdf}>
                <FontAwesomeIcon icon={faFilePdf} /> Ver PDF
              </button>
              <button className="btn-ghost" onClick={reabrirDia}>
                <FontAwesomeIcon icon={faLockOpen} /> Reabrir día
              </button>
            </>
          ) : (
            <>
              {movs.length > 0 && (
                <button className="btn-terminar" onClick={terminarDia}>
                  <FontAwesomeIcon icon={faFlagCheckered} /> Terminar el día
                </button>
              )}
              <button className="btn-primary" onClick={() => setModalAgregar(true)}>
                <FontAwesomeIcon icon={faPlus} /> Agregar movimiento
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Barra: fecha + filtros */}
      <div className="dia-barra">
        <label className="dia-label">
          Día:
          <input
            type="date"
            className="form-input dia-input"
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </label>
        <button
          className={"btn-ghost" + (mostrarFiltros || hayFiltros ? " filtros-activos" : "")}
          onClick={() => setMostrarFiltros((v) => !v)}
        >
          <FontAwesomeIcon icon={faFilter} /> Filtros avanzados
          {hayFiltros && <span className="filtros-punto" />}
        </button>
      </div>

      {mostrarFiltros && (
        <div className="filtros-card">
          <div className="filtro-campo">
            <label className="form-label">Cliente / Persona</label>
            <SearchableSelect
              opciones={opcionesPersona}
              valor={filtros.persona}
              onChange={(v) => setFiltros({ ...filtros, persona: v })}
              placeholder="Escribí para buscar..."
            />
          </div>
          <div className="filtro-campo">
            <label className="form-label">Producto</label>
            <SearchableSelect
              opciones={opcionesProducto}
              valor={filtros.producto}
              onChange={(v) => setFiltros({ ...filtros, producto: v })}
              placeholder="Escribí para buscar..."
            />
          </div>
          <div className="filtro-campo">
            <label className="form-label">Método de pago</label>
            <select
              className="form-input"
              value={filtros.metodo}
              onChange={(e) => setFiltros({ ...filtros, metodo: e.target.value })}
            >
              <option value="">Todos</option>
              {METODOS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="filtro-campo">
            <label className="form-label">Categoría</label>
            <select
              className="form-input"
              value={filtros.categoria}
              onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value })}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          <div className="filtro-campo">
            <label className="form-label">Monto (total)</label>
            <div className="montos-row">
              <input
                type="number"
                className="form-input"
                placeholder="Mín"
                value={filtros.montoMin}
                onChange={(e) => setFiltros({ ...filtros, montoMin: e.target.value })}
              />
              <input
                type="number"
                className="form-input"
                placeholder="Máx"
                value={filtros.montoMax}
                onChange={(e) => setFiltros({ ...filtros, montoMax: e.target.value })}
              />
            </div>
          </div>
          <div className="filtro-campo filtro-limpiar">
            <button className="btn-ghost" onClick={() => setFiltros(FILTROS_VACIOS)}>
              Limpiar filtros
            </button>
          </div>
        </div>
      )}

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : movs.length === 0 ? (
          <div className="table-empty">
            No hay movimientos el {fecha.split("-").reverse().join("/")}. Agregá el primero.
          </div>
        ) : visibles.length === 0 ? (
          <div className="table-empty">Ningún movimiento coincide con los filtros.</div>
        ) : (
          <table className="data-table tabla-movs">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Movimiento</th>
                <th>Producto</th>
                <th>Método</th>
                <th>Cant</th>
                <th>Precio Unit</th>
                <th>Descuento</th>
                <th>SubTotal</th>
                <th>Total</th>
                {!cerrado && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => {
                const g = m.tipo === "Gasto";
                return (
                  <tr key={m.id}>
                    <td className="codigo-cell">{m.numero}</td>
                    <td>{m.persona_nombre}</td>
                    <td>{m.persona_tipo}</td>
                    <td>
                      <span className={g ? "badge-gasto" : "badge-venta"}>{m.tipo}</span>
                    </td>
                    <td>{m.producto_nombre}</td>
                    <td>{m.metodo}</td>
                    <td className="num">{m.cantidad}</td>
                    <td className="num"><Monto valor={m.precio_unitario} gasto={g} /></td>
                    <td className="num">{fmt(m.descuento)}</td>
                    <td className="num"><Monto valor={m.subtotal} gasto={g} /></td>
                    <td className="num"><Monto valor={m.total} gasto={g} /></td>
                    {!cerrado && (
                      <td>
                        <button className="btn-icon-edit" onClick={() => setEnEdicion(m)} title="Editar">
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button className="btn-icon-danger" onClick={() => eliminar(m.id)} title="Eliminar">
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Resumen del día */}
      {visibles.length > 0 && (
        <div className="resumen-dia">
          <span>Movimientos: <b>{visibles.length}</b>{hayFiltros ? ` (de ${movs.length})` : ""}</span>
          <span>Ventas: <b>${fmt(totalVentas)}</b></span>
          <span>Gastos: <b className="monto-gasto">(${fmt(totalGastos)})</b></span>
          <span>Neto: <Monto valor={Math.abs(totalVentas - totalGastos)} gasto={totalVentas - totalGastos < 0} /></span>
        </div>
      )}

      {/* ===== Observaciones del día (van impresas en el PDF) ===== */}
      {!cargando && (
        <div className="obs-card">
          <div className="obs-head">
            <h3>
              <FontAwesomeIcon icon={faNoteSticky} /> Observaciones del día
            </h3>
            {esAdmin() && (
              <button className="btn-ghost" onClick={() => setModalObs(true)}>
                <FontAwesomeIcon icon={faPen} /> {obs.texto ? "Editar" : "Agregar"}
              </button>
            )}
          </div>
          {obs.texto ? (
            <>
              <p className="obs-texto">{obs.texto}</p>
              <span className="obs-meta">
                Última edición: {obs.actualizado_por || "—"} ·{" "}
                {obs.actualizado_en
                  ? new Date(obs.actualizado_en).toLocaleString("es-CR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : ""}
              </span>
            </>
          ) : (
            <p className="obs-vacia">
              Sin observaciones.{" "}
              {esAdmin()
                ? "Lo que escribás acá queda guardado y sale impreso en el PDF, incluso si lo regenerás después."
                : "Solo un administrador puede agregarlas; salen impresas en el PDF."}
            </p>
          )}
        </div>
      )}

      {modalObs && (
        <ObservacionForm
          fecha={fecha}
          textoInicial={obs.texto}
          onClose={() => setModalObs(false)}
          onGuardado={(nueva) => {
            setObs(nueva);
            setModalObs(false);
            avisoExito("Observaciones guardadas");
          }}
        />
      )}

      {(modalAgregar || enEdicion) && (
        <MovimientoForm
          fecha={fecha}
          existente={enEdicion}
          opcionesPersona={opcionesPersona}
          personas={personas}
          productos={productos}
          opcionesProducto={opcionesProducto}
          onClose={() => {
            setModalAgregar(false);
            setEnEdicion(null);
          }}
          onGuardado={(esEdicion) => {
            if (esEdicion) setEnEdicion(null); // al editar sí se cierra
            cargarDia(); // al agregar, el modal QUEDA abierto (pegajoso)
          }}
        />
      )}
    </div>
  );
}

// ===== Modal de observaciones del día (solo admin) =====
function ObservacionForm({ fecha, textoInicial, onClose, onGuardado }) {
  const [texto, setTexto] = useState(textoInicial || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const nueva = await apiPut(`/dias/${fecha}/observacion/`, { texto });
      onGuardado(nueva);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          Observaciones del día
          <span className="modal-fecha">{fecha.split("-").reverse().join("/")}</span>
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">
            Notas del día (salen impresas en el PDF)
          </label>
          <textarea
            className="form-input obs-textarea"
            rows={6}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej: Se recibió un pago pendiente de ayer; el cliente CR0012 quedó debiendo $20..."
            autoFocus
          />
          <p className="form-hint">
            Un solo texto por día: al guardar se reemplaza el anterior. Se puede
            editar aunque el día esté cerrado, y el PDF se regenera con lo nuevo.
          </p>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== Modal de agregar/editar movimiento =====
// En modo agregar es "pegajoso": guarda y queda abierto para el siguiente.
function MovimientoForm({
  fecha, existente, personas, productos, opcionesProducto, onClose, onGuardado,
}) {
  const editando = Boolean(existente);
  const [persona, setPersona] = useState(existente?.persona || "");
  const [producto, setProducto] = useState(existente?.producto || "");
  const [tipo, setTipo] = useState(existente?.tipo || "Venta");
  const [metodo, setMetodo] = useState(existente?.metodo || "Efectivo");
  const [cantidad, setCantidad] = useState(existente?.cantidad ?? 1);
  const [precio, setPrecio] = useState(existente?.precio_unitario || "");
  const [descuento, setDescuento] = useState(existente?.descuento ?? 0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // El modal solo ofrece los productos del tipo de movimiento elegido:
  // Venta -> productos de venta, Gasto -> productos de gasto.
  const opcionesProductoFiltradas = productos
    .filter((p) => p.uso === tipo)
    .map((p) => ({ id: p.id, label: `${p.nombre} — $${fmt(p.precio_unitario)}` }));

  // El modal solo ofrece las personas que corresponden al tipo de movimiento:
  // Gasto -> proveedores, Venta -> clientes y socios.
  const opcionesPersonaFiltradas = personas
    .filter((p) => (tipo === "Gasto" ? p.tipo === "Proveedor" : p.tipo !== "Proveedor"))
    .map((p) => ({ id: p.id, label: `${p.codigo} · ${p.nombre} (${p.tipo})` }));

  // Si cambia el tipo y el producto o la persona elegidos ya no corresponden, se limpian.
  function cambiarTipo(nuevo) {
    setTipo(nuevo);
    const p = productos.find((x) => String(x.id) === String(producto));
    if (p && p.uso !== nuevo) {
      setProducto("");
      setPrecio("");
    }
    const per = personas.find((x) => String(x.id) === String(persona));
    if (per) {
      const coincide = nuevo === "Gasto" ? per.tipo === "Proveedor" : per.tipo !== "Proveedor";
      if (!coincide) setPersona("");
    }
  }

  // Al elegir persona: sugerimos el tipo (Proveedor -> Gasto, resto -> Venta).
  function elegirPersona(id) {
    setPersona(id);
    const p = personas.find((x) => String(x.id) === String(id));
    if (p) cambiarTipo(p.tipo === "Proveedor" ? "Gasto" : "Venta");
  }

  // Al elegir producto: se copia su precio (snapshot editable).
  function elegirProducto(id) {
    setProducto(id);
    const p = productos.find((x) => String(x.id) === String(id));
    if (p) setPrecio(p.precio_unitario);
  }

  // SubTotal y Total en vivo mientras se escribe.
  const subtotal = (Number(cantidad) || 0) * (Number(precio) || 0) - (Number(descuento) || 0);

  async function guardar(e) {
    e.preventDefault();
    if (!persona || !producto) {
      setError("Seleccioná la persona y el producto.");
      return;
    }
    if (subtotal < 0) {
      setError("El descuento no puede ser mayor que cantidad × precio.");
      return;
    }
    setGuardando(true);
    setError("");
    const cuerpo = {
      fecha, tipo, metodo,
      persona, producto,
      cantidad: Number(cantidad),
      precio_unitario: precio,
      descuento: descuento === "" ? "0" : String(descuento),
    };
    try {
      if (editando) {
        await apiPut(`/movimientos/${existente.id}/`, cuerpo);
        avisoExito("Movimiento actualizado");
        onGuardado(true);
      } else {
        const nuevo = await apiPost("/movimientos/", cuerpo);
        avisoExito(`Movimiento #${nuevo.numero} agregado`);
        // Modal pegajoso: limpiamos para el siguiente, SIN cerrar.
        setPersona("");
        setProducto("");
        setTipo("Venta");
        setCantidad(1);
        setPrecio("");
        setDescuento(0);
        onGuardado(false);
      }
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-movimiento" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {editando ? `Editar movimiento #${existente.numero}` : "Nuevo movimiento"}
          <span className="modal-fecha">{fecha.split("-").reverse().join("/")}</span>
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">Persona (cliente, socio o proveedor)</label>
          <SearchableSelect
            opciones={opcionesPersonaFiltradas}
            valor={persona}
            onChange={elegirPersona}
            placeholder="Escribí el nombre para buscar..."
          />

          <div className="fila-2">
            <div>
              <label className="form-label">Movimiento</label>
              <select className="form-input" value={tipo} onChange={(e) => cambiarTipo(e.target.value)}>
                <option>Venta</option>
                <option>Gasto</option>
              </select>
            </div>
            <div>
              <label className="form-label">Método de pago</label>
              <select className="form-input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {METODOS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="form-label">Producto ({tipo === "Gasto" ? "de gasto" : "de venta"})</label>
          <SearchableSelect
            opciones={opcionesProductoFiltradas}
            valor={producto}
            onChange={elegirProducto}
            placeholder="Escribí el producto para buscar..."
          />

          <div className="fila-3">
            <div>
              <label className="form-label">Cantidad</label>
              <input
                type="number" min="1" className="form-input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label">Precio unit ($)</label>
              <input
                type="number" step="0.01" min="0" className="form-input"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label">Descuento ($)</label>
              <input
                type="number" step="0.01" min="0" className="form-input"
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
              />
            </div>
          </div>

          {/* Totales calculados en vivo */}
          <div className={"totales-vivo" + (tipo === "Gasto" ? " es-gasto" : "")}>
            <span>SubTotal: <b>{tipo === "Gasto" ? `($${fmt(subtotal)})` : `$${fmt(subtotal)}`}</b></span>
            <span>Total: <b>{tipo === "Gasto" ? `($${fmt(subtotal)})` : `$${fmt(subtotal)}`}</b></span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {editando ? "Cancelar" : "Cerrar"}
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? "Guardando..." : editando ? "Guardar cambios" : "Agregar y seguir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
