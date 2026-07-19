import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faPen,
  faMagnifyingGlass,
  faSpinner,
  faFileExcel,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { apiGet, apiPost, apiPut, apiDelete, buscarCedula } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import Paginacion from "./Paginacion";
import "./Crud.css";

const POR_PAGINA = 10;

/**
 * Sección genérica de personas. Clientes y Proveedores son la MISMA pantalla
 * con distinto 'tipo', así que se comparte todo el código:
 *   <PersonasSeccion tipo="Cliente"   titulo="Clientes"    singular="cliente"   icono={faUsers} />
 *   <PersonasSeccion tipo="Proveedor" titulo="Proveedores" singular="proveedor" icono={faTruck} />
 */
export default function PersonasSeccion({ tipo, titulo, singular, icono, filtroInicial = "" }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Puede venir pre-cargado desde la búsqueda global del navbar.
  const [busqueda, setBusqueda] = useState(filtroInicial);
  const [pagina, setPagina] = useState(1);
  // null = modal cerrado · {} = creando · {id,...} = editando ese registro
  const [enEdicion, setEnEdicion] = useState(null);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      setItems(await apiGet(`/personas/?tipo=${tipo}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  // Cargar al montar. (El cambio de sección remonta el componente vía 'key'.)
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  async function eliminar(id) {
    if (!(await confirmarEliminar(`este ${singular}`))) return;
    try {
      await apiDelete(`/personas/${id}/`);
      avisoExito(`${singular.charAt(0).toUpperCase() + singular.slice(1)} eliminado`);
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  // Filtro: código, nombre, cédula, teléfono o email.
  const texto = busqueda.trim().toLowerCase();
  const filtrados = texto
    ? items.filter((p) =>
        [p.codigo, p.nombre, p.cedula, p.telefono, p.email]
          .filter(Boolean)
          .some((campo) => campo.toLowerCase().includes(texto))
      )
    : items;

  // Paginación: recortamos solo las filas de la página actual.
  const visibles = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function exportarExcel() {
    const filas = items.map((p) => ({
      Código: p.codigo,
      Nombre: p.nombre,
      Cédula: p.cedula,
      Teléfono: p.telefono,
      Email: p.email,
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, titulo);
    XLSX.writeFile(libro, `${titulo}.xlsx`);
  }

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={icono} />
          <h1>{titulo}</h1>
        </div>
        <div className="page-actions">
          <button
            className="btn-secondary btn-wide"
            onClick={exportarExcel}
            disabled={items.length === 0}
          >
            <FontAwesomeIcon icon={faFileExcel} /> Exportar a Excel
          </button>
          <button className="btn-primary" onClick={() => setEnEdicion({})}>
            <FontAwesomeIcon icon={faPlus} /> Agregar {singular}
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="search-bar">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="search-bar-icon" />
        <input
          type="text"
          placeholder="Buscar por código, nombre, cédula, teléfono o email..."
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(1); // al cambiar la búsqueda, volvemos a la página 1
          }}
        />
      </div>

      <div className="table-card">
        {cargando ? (
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
          </div>
        ) : items.length === 0 ? (
          <div className="table-empty">
            Todavía no hay {titulo.toLowerCase()}. Agregá el primero con el botón de arriba.
          </div>
        ) : filtrados.length === 0 ? (
          <div className="table-empty">
            No se encontraron {titulo.toLowerCase()} que coincidan con "{busqueda}".
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Cédula</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td className="codigo-cell">{p.codigo}</td>
                  <td>{p.nombre}</td>
                  <td>{p.cedula}</td>
                  <td>{p.telefono || "—"}</td>
                  <td>{p.email || "—"}</td>
                  <td>
                    <button
                      className="btn-icon-edit"
                      onClick={() => setEnEdicion(p)}
                      title="Editar"
                    >
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                    <button
                      className="btn-icon-danger"
                      onClick={() => eliminar(p.id)}
                      title="Eliminar"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Paginacion
        total={filtrados.length}
        pagina={pagina}
        porPagina={POR_PAGINA}
        onCambio={setPagina}
      />

      {enEdicion !== null && (
        <PersonaForm
          tipo={tipo}
          singular={singular}
          existente={enEdicion.id ? enEdicion : null}
          onClose={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// ===== Formulario para crear O editar una persona (en un modal) =====
function PersonaForm({ tipo, singular, existente, onClose, onGuardado }) {
  // Si 'existente' viene con datos, el formulario arranca lleno (modo edición).
  const [cedula, setCedula] = useState(existente?.cedula || "");
  const [nombre, setNombre] = useState(existente?.nombre || "");
  const [telefono, setTelefono] = useState(existente?.telefono || "");
  const [email, setEmail] = useState(existente?.email || "");
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const editando = Boolean(existente);

  async function autocompletar() {
    if (!cedula.trim()) return;
    setBuscando(true);
    setError("");
    try {
      const data = await buscarCedula(cedula.trim());
      setNombre(data.nombre);
    } catch (e) {
      setError(e.message);
    } finally {
      setBuscando(false);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    const cuerpo = {
      cedula: cedula.trim(),
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      email: email.trim(),
      tipo,
    };
    try {
      if (editando) {
        // PUT = reemplazar el registro existente con estos datos.
        await apiPut(`/personas/${existente.id}/`, cuerpo);
      } else {
        await apiPost("/personas/", cuerpo);
      }
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
        <h2 className="modal-title">
          {editando ? `Editar ${singular}` : `Nuevo ${singular}`}
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">Cédula</label>
          <div className="cedula-row">
            <input
              className="form-input"
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              placeholder="118640449"
              autoFocus={!editando}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={autocompletar}
              disabled={buscando}
              title="Buscar en el padrón"
            >
              <FontAwesomeIcon icon={buscando ? faSpinner : faMagnifyingGlass} spin={buscando} />
            </button>
          </div>
          <p className="form-hint">
            Escribí la cédula y tocá la lupa para traer el nombre del padrón.
          </p>

          <label className="form-label">Nombre</label>
          <input
            className="form-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre completo"
            required
          />

          <label className="form-label">Teléfono</label>
          <input
            className="form-input"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="8888-8888"
          />

          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
          />

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
