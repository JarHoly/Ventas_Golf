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
  faFileExcel,
  faLock,
  faLockOpen,
  faFlagCheckered,
  faNoteSticky,
  faBoxOpen,
} from "@fortawesome/free-solid-svg-icons";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import { apiGet, apiPost, apiPut, apiDelete, apiGetBlob, esAdmin } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import SearchableSelect from "./SearchableSelect";
import ModalOverlay from "./ModalOverlay";
import "./Crud.css";
import "./Movimientos.css";

const METODOS = ["Efectivo", "Tarjeta", "Sinpe", "Transferencia"];
const SIMBOLOS = { USD: "$", CRC: "₡" };

// Formatea 1500 -> "1,500.00"
const fmt = (n) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Los montos de un gasto se muestran en rojo y entre paréntesis (estilo contable).
function Monto({ valor, gasto, moneda = "USD" }) {
  const texto = `${SIMBOLOS[moneda] || "$"}${fmt(valor)}`;
  return <span className={gasto ? "monto-gasto" : ""}>{gasto ? `(${texto})` : texto}</span>;
}

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const FILTROS_VACIOS = { persona: "", producto: "", metodo: "", categoria: "", montoMin: "", montoMax: "" };

export default function Movimientos() {
  // "dia" = la vista de siempre (agregar/editar/terminar el día).
  // "rango" = solo consulta: varios días a la vez, con los mismos filtros,
  // para generar un PDF o Excel de lo que se ve en pantalla.
  const [modo, setModo] = useState("dia");
  const [fecha, setFecha] = useState(hoy());
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [movs, setMovs] = useState([]);
  const [cerrado, setCerrado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [generandoPdf, setGenerandoPdf] = useState(false);

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
    if (modo !== "dia") return;
    cargarDia(fecha);
    setModalAgregar(false);
    setEnEdicion(null);
    setFiltros(FILTROS_VACIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, fecha]);

  // Modo "Rango de fechas": trae los movimientos de varios días de una vez.
  // Es solo consulta (no se agrega/edita/borra desde acá), así que no hace
  // falta el estado del día ni las observaciones.
  const rangoValido = Boolean(desde && hasta && desde <= hasta);

  async function cargarRango() {
    if (!rangoValido) return;
    setCargando(true);
    setError("");
    try {
      setMovs(await apiGet(`/movimientos/?desde=${desde}&hasta=${hasta}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (modo !== "rango") return;
    cargarRango();
    setFiltros(FILTROS_VACIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, desde, hasta]);

  function cambiarModo(nuevo) {
    setModo(nuevo);
    setMostrarFiltros(false);
    setFiltros(FILTROS_VACIOS);
  }

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

  // Arma la query string del rango + los mismos filtros avanzados que ya
  // están aplicados en pantalla, para que el PDF/Excel traigan exactamente
  // lo que se está viendo.
  function queryRango() {
    const p = new URLSearchParams({ desde, hasta });
    if (filtros.persona) p.set("persona", filtros.persona);
    if (filtros.producto) p.set("producto", filtros.producto);
    if (filtros.metodo) p.set("metodo", filtros.metodo);
    if (filtros.categoria) p.set("categoria", filtros.categoria);
    if (filtros.montoMin !== "") p.set("monto_min", filtros.montoMin);
    if (filtros.montoMax !== "") p.set("monto_max", filtros.montoMax);
    return p.toString();
  }

  async function generarPdfRango() {
    setGenerandoPdf(true);
    try {
      const blob = await apiGetBlob(`/reportes/rango/pdf/?${queryRango()}`);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setGenerandoPdf(false);
    }
  }

  // El Excel se arma del lado del cliente, con lo mismo que se ve en la
  // tabla (misma lista ya filtrada): no hace falta ir de nuevo al backend.
  function exportarExcelRango() {
    const filas = visibles.map((m) => ({
      "#": m.numero,
      Fecha: m.fecha,
      "Cliente / Proveedor": m.persona_nombre,
      Tipo: m.persona_tipo,
      Movimiento: m.tipo,
      Producto: m.producto_nombre,
      Método: m.metodo,
      Moneda: m.moneda,
      Cantidad: m.cantidad,
      "Precio Unit": Number(m.precio_unitario),
      Descuento: Number(m.descuento),
      SubTotal: Number(m.subtotal),
      Total: Number(m.total),
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Movimientos");
    XLSX.writeFile(libro, `Movimientos_${desde}_${hasta}.xlsx`);
  }

  // ---------- Filtros avanzados (sobre la lista ya cargada) ----------
  const visibles = movs.filter((m) => {
    if (filtros.persona && String(m.persona) !== String(filtros.persona)) return false;
    if (filtros.producto && String(m.producto) !== String(filtros.producto)) return false;
    if (filtros.metodo && m.metodo !== filtros.metodo) return false;
    if (filtros.categoria && String(m.categoria_id) !== String(filtros.categoria)) return false;
    // El filtro de monto compara el total de cada movimiento EN SU PROPIA
    // moneda (no se convierte ni se mezcla USD con CRC).
    if (filtros.montoMin !== "" && Number(m.total) < Number(filtros.montoMin)) return false;
    if (filtros.montoMax !== "" && Number(m.total) > Number(filtros.montoMax)) return false;
    return true;
  });
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS);

  // Totales del día (sobre lo visible), SEPARADOS por moneda: no se convierte
  // ni se suma dólares con colones.
  const sumaPor = (tipo, moneda) =>
    visibles
      .filter((m) => m.tipo === tipo && m.moneda === moneda)
      .reduce((s, m) => s + Number(m.total), 0);
  const totalVentas = sumaPor("Venta", "USD");
  const totalGastos = sumaPor("Gasto", "USD");
  const totalVentasCRC = sumaPor("Venta", "CRC");
  const totalGastosCRC = sumaPor("Gasto", "CRC");

  // Resumen de productos (solo día único): cuánto se vendió de cada producto
  // y por cuál método de pago — cantidad Y monto separados POR método (no
  // solo un total general), para poder ver cuánto de esa cantidad fue en
  // efectivo, cuánto en tarjeta, etc. Solo Ventas en USD — los gastos son de
  // proveedores y no tiene sentido mezclarlos acá, mismo criterio que la
  // dona de distribución por método.
  const METODOS_RESUMEN = ["Tarjeta", "Efectivo", "Transferencia", "Sinpe"];
  const resumenProductos = (() => {
    const porProducto = {};
    visibles
      .filter((m) => m.tipo === "Venta" && m.moneda === "USD")
      .forEach((m) => {
        if (!porProducto[m.producto_nombre]) {
          porProducto[m.producto_nombre] = { metodos: {} };
        }
        const fila = porProducto[m.producto_nombre].metodos;
        if (!fila[m.metodo]) fila[m.metodo] = { cantidad: 0, monto: 0 };
        fila[m.metodo].cantidad += Number(m.cantidad);
        fila[m.metodo].monto += Number(m.total);
      });
    return Object.entries(porProducto)
      .map(([producto, datos]) => {
        // La cantidad y el monto totales del producto son la SUMA de lo que
        // haya en cada método: así queda claro que ambos números coinciden.
        const cantidad = Object.values(datos.metodos).reduce((s, v) => s + v.cantidad, 0);
        const total = Object.values(datos.metodos).reduce((s, v) => s + v.monto, 0);
        return { producto, metodos: datos.metodos, cantidad, total };
      })
      .sort((a, b) => b.total - a.total);
  })();
  const totalesResumenProductos = {
    cantidad: resumenProductos.reduce((s, r) => s + r.cantidad, 0),
    metodos: METODOS_RESUMEN.reduce((acc, met) => {
      acc[met] = {
        cantidad: resumenProductos.reduce((s, r) => s + (r.metodos[met]?.cantidad || 0), 0),
        monto: resumenProductos.reduce((s, r) => s + (r.metodos[met]?.monto || 0), 0),
      };
      return acc;
    }, {}),
  };

  // Etiquetas para los selects con búsqueda.
  const opcionesPersona = personas.map((p) => ({ id: p.id, label: `${p.codigo} · ${p.nombre} (${p.tipo})` }));
  const opcionesProducto = productos.map((p) => ({ id: p.id, label: `${p.nombre} · $${fmt(p.precio_unitario)}` }));

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faMoneyBillTransfer} />
          <h1>Movimientos Diarios</h1>
        </div>
        <div className="page-actions">
          {modo === "dia" ? (
            cerrado ? (
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
            )
          ) : (
            <>
              <button
                className="btn-secondary btn-wide"
                onClick={exportarExcelRango}
                disabled={!rangoValido || visibles.length === 0}
              >
                <FontAwesomeIcon icon={faFileExcel} /> Exportar a Excel
              </button>
              <button
                className="btn-primary"
                onClick={generarPdfRango}
                disabled={!rangoValido || generandoPdf}
              >
                <FontAwesomeIcon icon={generandoPdf ? faSpinner : faFilePdf} spin={generandoPdf} />{" "}
                Generar PDF
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Barra: modo + fecha(s) + filtros */}
      <div className="dia-barra">
        <div className="modo-toggle">
          <button className={modo === "dia" ? "activo" : ""} onClick={() => cambiarModo("dia")}>
            Día único
          </button>
          <button className={modo === "rango" ? "activo" : ""} onClick={() => cambiarModo("rango")}>
            Rango de fechas
          </button>
        </div>
        {modo === "dia" ? (
          <label className="dia-label">
            Día:
            <input
              type="date"
              className="form-input dia-input"
              value={fecha}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="dia-label">
              Desde:
              <input
                type="date"
                className="form-input dia-input"
                value={desde}
                onChange={(e) => e.target.value && setDesde(e.target.value)}
              />
            </label>
            <label className="dia-label">
              Hasta:
              <input
                type="date"
                className="form-input dia-input"
                value={hasta}
                onChange={(e) => e.target.value && setHasta(e.target.value)}
              />
            </label>
            {!rangoValido && (
              <span className="alert-error">La fecha "desde" debe ser anterior (o igual) a "hasta".</span>
            )}
          </>
        )}
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
            <label className="form-label">Monto (total, en su propia moneda)</label>
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
        ) : modo === "dia" && movs.length === 0 ? (
          <div className="table-empty">
            No hay movimientos el {fecha.split("-").reverse().join("/")}. Agregá el primero.
          </div>
        ) : visibles.length === 0 ? (
          <div className="table-empty">
            {modo === "rango"
              ? "Ningún movimiento coincide con el rango y los filtros elegidos."
              : "Ningún movimiento coincide con los filtros."}
          </div>
        ) : (
          <table className="data-table tabla-movs">
            <thead>
              <tr>
                <th>#</th>
                {modo === "rango" && <th>Fecha</th>}
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Movimiento</th>
                <th>Producto</th>
                <th>Método</th>
                <th>Moneda</th>
                <th>Cant</th>
                <th>Precio Unit</th>
                <th>Descuento</th>
                <th>SubTotal</th>
                <th>Total</th>
                {modo === "dia" && !cerrado && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => {
                const g = m.tipo === "Gasto";
                return (
                  <tr key={m.id}>
                    <td className="codigo-cell">{m.numero}</td>
                    {modo === "rango" && <td>{m.fecha.split("-").reverse().join("/")}</td>}
                    <td>{m.persona_nombre}</td>
                    <td>{m.persona_tipo}</td>
                    <td>
                      <span className={g ? "badge-gasto" : "badge-venta"}>{m.tipo}</span>
                    </td>
                    <td>{m.producto_nombre}</td>
                    <td>{m.metodo}</td>
                    <td>
                      <span className="badge-moneda">{m.moneda}</span>
                    </td>
                    <td className="num">{m.cantidad}</td>
                    <td className="num"><Monto valor={m.precio_unitario} gasto={g} moneda={m.moneda} /></td>
                    <td className="num">{SIMBOLOS[m.moneda]}{fmt(m.descuento)}</td>
                    <td className="num"><Monto valor={m.subtotal} gasto={g} moneda={m.moneda} /></td>
                    <td className="num"><Monto valor={m.total} gasto={g} moneda={m.moneda} /></td>
                    {modo === "dia" && !cerrado && (
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
          <span>
            Ventas: <b>${fmt(totalVentas)}</b>
            {totalVentasCRC > 0 && <b> + ₡{fmt(totalVentasCRC)}</b>}
          </span>
          <span>
            Gastos: <b className="monto-gasto">(${fmt(totalGastos)})</b>
            {totalGastosCRC > 0 && <b className="monto-gasto"> + (₡{fmt(totalGastosCRC)})</b>}
          </span>
          <span>
            Neto: <Monto valor={Math.abs(totalVentas - totalGastos)} gasto={totalVentas - totalGastos < 0} />
            {totalVentasCRC > 0 || totalGastosCRC > 0 ? (
              <>
                {" + "}
                <Monto
                  valor={Math.abs(totalVentasCRC - totalGastosCRC)}
                  gasto={totalVentasCRC - totalGastosCRC < 0}
                  moneda="CRC"
                />
              </>
            ) : null}
          </span>
        </div>
      )}

      {/* ===== Resumen de productos (también sale en el PDF del día) ===== */}
      {modo === "dia" && !cargando && resumenProductos.length > 0 && (
        <div className="table-card resumen-prod-card">
          <div className="resumen-prod-head">
            <h3>
              <FontAwesomeIcon icon={faBoxOpen} /> Resumen de productos
            </h3>
          </div>
          <table className="data-table tabla-resumen-prod">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                {METODOS_RESUMEN.map((met) => (
                  <th className="num" key={met}>{met}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resumenProductos.map((r) => (
                <tr key={r.producto}>
                  <td>{r.producto}</td>
                  <td className="num">{r.cantidad}</td>
                  {METODOS_RESUMEN.map((met) => (
                    <td className="num" key={met}>
                      {r.metodos[met] ? `${r.metodos[met].cantidad} · $${fmt(r.metodos[met].monto)}` : "-"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="resumen-prod-total">
                <td>TOTAL</td>
                <td className="num">{totalesResumenProductos.cantidad}</td>
                {METODOS_RESUMEN.map((met) => (
                  <td className="num" key={met}>
                    {totalesResumenProductos.metodos[met].cantidad
                      ? `${totalesResumenProductos.metodos[met].cantidad} · $${fmt(totalesResumenProductos.metodos[met].monto)}`
                      : "-"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Observaciones del día (van impresas en el PDF) ===== */}
      {modo === "dia" && !cargando && (
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
                Última edición: {obs.actualizado_por || "Sin registrar"} ·{" "}
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
    <ModalOverlay onClose={onClose}>
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
    </ModalOverlay>
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
  const [moneda, setMoneda] = useState(existente?.moneda || "USD");
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
      moneda,
    };
    try {
      if (editando) {
        await apiPut(`/movimientos/${existente.id}/`, cuerpo);
        avisoExito("Movimiento actualizado");
        onGuardado(true);
      } else {
        const nuevo = await apiPost("/movimientos/", cuerpo);
        avisoExito(`Movimiento #${nuevo.numero} agregado`);
        // Modal pegajoso: limpiamos para el siguiente, SIN cerrar (la
        // moneda queda, suele repetirse en la racha).
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
    <ModalOverlay onClose={onClose}>
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

          <label className="form-label">Moneda</label>
          <select className="form-input" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="USD">Dólares (USD)</option>
            <option value="CRC">Colones (CRC)</option>
          </select>

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
              <label className="form-label">Precio unit ({SIMBOLOS[moneda]})</label>
              <input
                type="number" step="0.01" min="0" className="form-input"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label">Descuento ({SIMBOLOS[moneda]})</label>
              <input
                type="number" step="0.01" min="0" className="form-input"
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
              />
            </div>
          </div>

          {/* Totales calculados en vivo (en la moneda elegida) */}
          <div className={"totales-vivo" + (tipo === "Gasto" ? " es-gasto" : "")}>
            <span>SubTotal: <b>{tipo === "Gasto" ? `(${SIMBOLOS[moneda]}${fmt(subtotal)})` : `${SIMBOLOS[moneda]}${fmt(subtotal)}`}</b></span>
            <span>Total: <b>{tipo === "Gasto" ? `(${SIMBOLOS[moneda]}${fmt(subtotal)})` : `${SIMBOLOS[moneda]}${fmt(subtotal)}`}</b></span>
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
    </ModalOverlay>
  );
}
