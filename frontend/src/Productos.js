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
import { useOrden, ThOrden } from "./Ordenamiento";
import ModalOverlay from "./ModalOverlay";
import "./Crud.css";

const POR_PAGINA = 10;
const TIPOS = ["Alquiler", "Servicio", "Unidad"];
// Color del badge de "uso" en la tabla. "Ambos" lleva el suyo: no es ni una
// venta ni un gasto, es mercadería que pasa por los dos lados.
const CLASE_USO = {
  Venta: "badge-venta",
  Gasto: "badge-gasto",
  Ambos: "badge-ambos",
};

export default function Productos({ filtroInicial = "" }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState(filtroInicial);
  const [pagina, setPagina] = useState(1);
  const [enEdicion, setEnEdicion] = useState(null);
  const { orden, cambiarOrden, ordenar } = useOrden();

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
  const ordenados = ordenar(filtrados, (p, campo) =>
    campo === "precio_unitario" ? Number(p[campo]) : p[campo]
  );
  const visibles = ordenados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function exportarExcel() {
    const filas = items.map((p) => ({
      Nombre: p.nombre,
      Tipo: p.tipo,
      Uso: p.uso === "Ambos" ? "Venta y Gasto" : p.uso,
      "Precio Unitario": Number(p.precio_unitario),
      Categoría: p.categoria_nombre,
      "Controla inventario": p.controla_inventario ? "Sí" : "No",
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
                <ThOrden campo="nombre" orden={orden} onClick={cambiarOrden}>Nombre</ThOrden>
                <ThOrden campo="tipo" orden={orden} onClick={cambiarOrden}>Tipo</ThOrden>
                <ThOrden campo="uso" orden={orden} onClick={cambiarOrden}>Uso</ThOrden>
                <ThOrden campo="precio_unitario" orden={orden} onClick={cambiarOrden}>Precio Unitario</ThOrden>
                <ThOrden campo="categoria_nombre" orden={orden} onClick={cambiarOrden}>Categoría</ThOrden>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.nombre}
                    {p.rol_especial === "Membresia" && (
                      <span className="badge-rol" title={`Membresía de ${p.dias_vigencia} días · ${p.usos_carrito} usos de carrito`}>
                        Membresía
                      </span>
                    )}
                    {p.rol_especial === "Carrito" && (
                      <span className="badge-rol" title="Descuenta usos de la membresía del cliente">
                        Carrito
                      </span>
                    )}
                    {p.controla_inventario && (
                      <span className="badge-inv" title="Lleva existencias: suma al comprar y resta al vender">
                        Inventario
                      </span>
                    )}
                  </td>
                  <td>{p.tipo}</td>
                  <td>
                    <span className={CLASE_USO[p.uso] || "badge-venta"}>
                      {p.uso === "Ambos" ? "Venta y Gasto" : p.uso}
                    </span>
                  </td>
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
  const [uso, setUso] = useState(existente?.uso || "Venta");
  const [precio, setPrecio] = useState(existente?.precio_unitario || "");
  const [categoria, setCategoria] = useState(existente?.categoria || "");
  const [rolEspecial, setRolEspecial] = useState(existente?.rol_especial || "");
  const [diasVigencia, setDiasVigencia] = useState(existente?.dias_vigencia ?? 365);
  const [usosCarrito, setUsosCarrito] = useState(existente?.usos_carrito ?? 50);
  const [controlaInventario, setControlaInventario] = useState(
    existente?.controla_inventario ?? false
  );
  const [categorias, setCategorias] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const editando = Boolean(existente);
  // Un Servicio no tiene nada físico que contar (una clase no se guarda en
  // bodega): se le esconde la casilla de inventario para que no se marque
  // por error y ensucie el reporte de existencias.
  const esServicio = tipo === "Servicio";

  function cambiarTipo(nuevo) {
    setTipo(nuevo);
    if (nuevo === "Servicio") setControlaInventario(false);
  }

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
      uso,
      precio_unitario: precio,
      categoria, // se manda el id de la categoría
      // Se fuerza en falso para los servicios: aunque la casilla esté
      // escondida, el estado pudo quedar marcado de antes de cambiar el tipo.
      controla_inventario: esServicio ? false : controlaInventario,
      rol_especial: rolEspecial,
      dias_vigencia: Number(diasVigencia) || 365,
      usos_carrito: Number(usosCarrito) || 0,
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
    <ModalOverlay onClose={onClose}>
      <div className="modal modal-2col" onClick={(e) => e.stopPropagation()}>
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

          {/* De acá para abajo, los campos cortos van de a dos por fila:
              el formulario entra de una sola mirada en vez de obligar a
              hacer scroll dentro del modal. En teléfono vuelven a una
              columna (ver .form-fila-2 en Crud.css). */}
          <div className="form-fila-2">
            <div>
              <label className="form-label">Tipo</label>
              <select
                className="form-input"
                value={tipo}
                onChange={(e) => cambiarTipo(e.target.value)}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Uso (¿en qué movimiento?)</label>
              <select
                className="form-input"
                value={uso}
                onChange={(e) => setUso(e.target.value)}
              >
                <option value="Venta">Venta</option>
                <option value="Gasto">Gasto</option>
                {/* Mercadería que se le compra al proveedor y se le vende al
                    cliente: las bolas, los guantes, las bebidas. */}
                <option value="Ambos">Venta y Gasto</option>
              </select>
            </div>
          </div>

          <div className="form-fila-2">
            <div>
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
            </div>
            <div>
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
            </div>
          </div>

          {/* Control de inventario: al comprarlo (gasto) suma existencias,
              al venderlo resta, y entra al reporte de rotación. Los
              servicios y las clases van apagados. */}
          {esServicio ? (
            <p className="form-hint form-hint-solo">
              Los servicios no llevan existencias.
            </p>
          ) : (
            <label className="form-check">
              <input
                type="checkbox"
                checked={controlaInventario}
                onChange={(e) => setControlaInventario(e.target.checked)}
              />
              <span>
                <b>Controla inventario</b> - lleva existencias
              </span>
            </label>
          )}

          {/* Control de membresías: acá se define QUÉ producto es la
              membresía y CUÁL descuenta usos de carrito, en vez de dejarlo
              quemado en el código. */}
          <label className="form-label">Control de membresías</label>
          <select
            className="form-input"
            value={rolEspecial}
            onChange={(e) => setRolEspecial(e.target.value)}
          >
            <option value="">Producto normal (no participa)</option>
            <option value="Membresia">Es una membresía (al venderla se activa/renueva)</option>
            <option value="Carrito">Es un carrito de golf (descuenta usos)</option>
          </select>

          {rolEspecial === "Membresia" && (
            <>
              <div className="form-fila-2">
                <div>
                  <label className="form-label">Días de vigencia</label>
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    value={diasVigencia}
                    onChange={(e) => setDiasVigencia(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Usos de carrito incluidos</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={usosCarrito}
                    onChange={(e) => setUsosCarrito(e.target.value)}
                    required
                  />
                </div>
              </div>
              <p className="form-hint">
                Al renovar, los días que le sobraban al cliente se suman a la
                nueva vigencia (no se pierden), pero los usos de carrito
                vuelven a empezar desde {usosCarrito || 0}.
              </p>
            </>
          )}

          {rolEspecial === "Carrito" && (
            <p className="form-hint">
              Cada venta de este producto descuenta usos de la membresía del
              cliente, según la cantidad del movimiento.
            </p>
          )}

          {editando && rolEspecial !== (existente?.rol_especial || "") && (
            <p className="form-hint">
              Al guardar, se revisan los movimientos YA registrados de este
              producto para armar (o deshacer) las membresías del historial.
            </p>
          )}

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
    </ModalOverlay>
  );
}
