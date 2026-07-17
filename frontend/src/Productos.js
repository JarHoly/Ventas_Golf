import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxOpen,
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
const TIPOS = ["Alquiler", "Servicio", "Unidad"];

export default function Productos() {
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
      setItems(await apiGet("/productos/"));
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
    if (!(await confirmarEliminar("este producto"))) return;
    try {
      await apiDelete(`/productos/${id}/`);
      avisoExito("Producto eliminado");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  // Filtro: nombre, tipo, categoría o precio.
  const texto = busqueda.trim().toLowerCase();
  const filtrados = texto
    ? items.filter((p) =>
        [p.nombre, p.tipo, p.categoria_nombre, String(p.precio_unitario)]
          .filter(Boolean)
          .some((campo) => campo.toLowerCase().includes(texto))
      )
    : items;
  const visibles = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function exportarExcel() {
    const filas = items.map((p) => ({
      Nombre: p.nombre,
      Tipo: p.tipo,
      "Precio Unitario": Number(p.precio_unitario),
      Categoría: p.categoria_nombre,
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Productos");
    XLSX.writeFile(libro, "Productos.xlsx");
  }

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faBoxOpen} />
          <h1>Productos</h1>
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
            <FontAwesomeIcon icon={faPlus} /> Agregar producto
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="search-bar">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="search-bar-icon" />
        <input
          type="text"
          placeholder="Buscar por nombre, tipo, categoría o precio..."
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
            Todavía no hay productos. Agregá el primero con el botón de arriba.
          </div>
        ) : filtrados.length === 0 ? (
          <div className="table-empty">
            No se encontraron productos que coincidan con "{busqueda}".
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Precio Unitario</th>
                <th>Categoría</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td>{p.tipo}</td>
                  <td>${Number(p.precio_unitario).toFixed(2)}</td>
                  <td>{p.categoria_nombre}</td>
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
        <ProductoForm
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

function ProductoForm({ existente, onClose, onGuardado }) {
  const [nombre, setNombre] = useState(existente?.nombre || "");
  const [tipo, setTipo] = useState(existente?.tipo || "Unidad");
  const [precio, setPrecio] = useState(existente?.precio_unitario || "");
  const [categoria, setCategoria] = useState(existente?.categoria || "");
  const [categorias, setCategorias] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const editando = Boolean(existente);

  // El <select> de categorías necesita la lista: la pedimos al abrir el modal.
  useEffect(() => {
    apiGet("/categorias/")
      .then(setCategorias)
      .catch((e) => setError(e.message));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    const cuerpo = {
      nombre: nombre.trim(),
      tipo,
      precio_unitario: precio,
      categoria, // se manda el id de la categoría
    };
    try {
      if (editando) {
        await apiPut(`/productos/${existente.id}/`, cuerpo);
      } else {
        await apiPost("/productos/", cuerpo);
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
          {editando ? "Editar producto" : "Nuevo producto"}
        </h2>

        {error && <div className="alert-error">{error}</div>}

        {categorias.length === 0 && !error && (
          <div className="alert-error">
            Primero necesitás crear al menos una categoría (sección Categorías).
          </div>
        )}

        <form onSubmit={guardar}>
          <label className="form-label">Nombre</label>
          <input
            className="form-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Bolas de golf"
            required
            autoFocus
          />

          <label className="form-label">Tipo</label>
          <select
            className="form-input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label className="form-label">Precio unitario ($)</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            min="0"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0.00"
            required
          />

          <label className="form-label">Categoría</label>
          <select
            className="form-input"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            required
          >
            <option value="" disabled>
              Seleccioná una categoría...
            </option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={guardando || categorias.length === 0}
            >
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
