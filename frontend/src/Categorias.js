import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTags,
  faPlus,
  faTrash,
  faPen,
  faMagnifyingGlass,
  faSpinner,
  faFileExcel,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import Paginacion from "./Paginacion";
import "./Crud.css";

const POR_PAGINA = 10;

export default function Categorias() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [enEdicion, setEnEdicion] = useState(null);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      setItems(await apiGet("/categorias/"));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function eliminar(id) {
    if (!(await confirmarEliminar("esta categoría"))) return;
    try {
      await apiDelete(`/categorias/${id}/`);
      avisoExito("Categoría eliminada");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  const texto = busqueda.trim().toLowerCase();
  const filtrados = texto
    ? items.filter((c) => c.nombre.toLowerCase().includes(texto))
    : items;
  const visibles = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function exportarExcel() {
    const filas = items.map((c) => ({ Nombre: c.nombre }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Categorías");
    XLSX.writeFile(libro, "Categorias.xlsx");
  }

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faTags} />
          <h1>Categorías</h1>
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
            <FontAwesomeIcon icon={faPlus} /> Agregar categoría
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="search-bar">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="search-bar-icon" />
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(1);
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
            Todavía no hay categorías. Agregá la primera con el botón de arriba.
          </div>
        ) : filtrados.length === 0 ? (
          <div className="table-empty">
            No se encontraron categorías que coincidan con "{busqueda}".
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td>
                    <button
                      className="btn-icon-edit"
                      onClick={() => setEnEdicion(c)}
                      title="Editar"
                    >
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                    <button
                      className="btn-icon-danger"
                      onClick={() => eliminar(c.id)}
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
        <CategoriaForm
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

function CategoriaForm({ existente, onClose, onGuardado }) {
  const [nombre, setNombre] = useState(existente?.nombre || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const editando = Boolean(existente);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      if (editando) {
        await apiPut(`/categorias/${existente.id}/`, { nombre: nombre.trim() });
      } else {
        await apiPost("/categorias/", { nombre: nombre.trim() });
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
          {editando ? "Editar categoría" : "Nueva categoría"}
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">Nombre</label>
          <input
            className="form-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Bolas, Carritos, Clases..."
            required
            autoFocus
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
