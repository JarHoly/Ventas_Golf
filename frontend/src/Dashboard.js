import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGolfBallTee,
  faMagnifyingGlass,
  faRightFromBracket,
  faUsers,
  faTruck,
  faTags,
  faBoxOpen,
  faMoneyBillTransfer,
} from "@fortawesome/free-solid-svg-icons";
import { apiGet } from "./api";
import PersonasSeccion from "./PersonasSeccion";
import Categorias from "./Categorias";
import Productos from "./Productos";
import Movimientos from "./Movimientos";
import "./Dashboard.css";

// Las secciones del sidebar. Agregar una nueva es solo sumar un objeto aquí.
const MENU = [
  {
    id: "movimientos",
    label: "Movimientos Diarios",
    icon: faMoneyBillTransfer,
  },
  { id: "clientes", label: "Clientes", icon: faUsers },
  { id: "productos", label: "Productos", icon: faBoxOpen },
  { id: "proveedores", label: "Proveedores", icon: faTruck },
  { id: "categorias", label: "Categorías", icon: faTags },
];

export default function Dashboard({ onLogout }) {
  const [seccion, setSeccion] = useState("clientes");
  // Filtro que la búsqueda global inyecta a la sección destino.
  const [filtroInicial, setFiltroInicial] = useState("");

  // ===== Búsqueda global del navbar =====
  const [busqueda, setBusqueda] = useState("");
  const [catalogo, setCatalogo] = useState([]); // índice de todo lo buscable
  const [abierto, setAbierto] = useState(false);
  const cajaBusqueda = useRef(null);

  // Arma el índice: clientes, proveedores, productos y categorías.
  async function cargarCatalogo() {
    try {
      const [personas, productos, categorias] = await Promise.all([
        apiGet("/personas/"),
        apiGet("/productos/"),
        apiGet("/categorias/"),
      ]);
      const idx = [];
      personas.forEach((p) => {
        if (p.tipo === "Cliente")
          idx.push({
            tipo: "Cliente",
            icono: faUsers,
            label: `${p.codigo} · ${p.nombre}`,
            seccion: "clientes",
            term: p.nombre,
          });
        else if (p.tipo === "Proveedor")
          idx.push({
            tipo: "Proveedor",
            icono: faTruck,
            label: `${p.codigo} · ${p.nombre}`,
            seccion: "proveedores",
            term: p.nombre,
          });
      });
      productos.forEach((p) =>
        idx.push({
          tipo: "Producto",
          icono: faBoxOpen,
          label: p.nombre,
          seccion: "productos",
          term: p.nombre,
        }),
      );
      categorias.forEach((c) =>
        idx.push({
          tipo: "Categoría",
          icono: faTags,
          label: c.nombre,
          seccion: "categorias",
          term: c.nombre,
        }),
      );
      setCatalogo(idx);
    } catch {
      // silencioso: si falla, la búsqueda simplemente no muestra resultados
    }
  }

  useEffect(() => {
    cargarCatalogo();
  }, []);

  // Cerrar el desplegable al hacer clic fuera.
  useEffect(() => {
    function clicFuera(e) {
      if (cajaBusqueda.current && !cajaBusqueda.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", clicFuera);
    return () => document.removeEventListener("mousedown", clicFuera);
  }, []);

  const q = busqueda.trim().toLowerCase();
  const resultados = q
    ? catalogo.filter((r) => r.label.toLowerCase().includes(q)).slice(0, 8)
    : [];

  // Ir a una sección desde un resultado, con el filtro ya aplicado.
  function irAResultado(r) {
    setFiltroInicial(r.term);
    setSeccion(r.seccion);
    setBusqueda("");
    setAbierto(false);
  }

  // Navegación normal del sidebar: limpia cualquier filtro de la búsqueda.
  function irASeccion(id) {
    setFiltroInicial("");
    setSeccion(id);
  }

  return (
    <div className="dash">
      {/* ===== NAVBAR ===== */}
      <header className="navbar">
        <div className="nav-brand">
          <span className="nav-brand-icon">
            <FontAwesomeIcon icon={faGolfBallTee} />
          </span>
          <span className="nav-brand-name">E-Cuestas</span>
        </div>

        <div className="nav-right">
          <div className="nav-search-box" ref={cajaBusqueda}>
            <div className="nav-search">
              <FontAwesomeIcon
                icon={faMagnifyingGlass}
                className="nav-search-icon"
              />
              <input
                type="text"
                placeholder="Buscar clientes, proveedores, productos..."
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setAbierto(true);
                }}
                onFocus={() => {
                  setAbierto(true);
                  cargarCatalogo(); // refresca el índice por si hay datos nuevos
                }}
              />
            </div>

            {abierto && q && (
              <div className="nav-results">
                {resultados.length === 0 ? (
                  <div className="nav-results-empty">
                    Sin resultados para "{busqueda}"
                  </div>
                ) : (
                  resultados.map((r, i) => (
                    <button
                      key={i}
                      className="nav-result"
                      onClick={() => irAResultado(r)}
                    >
                      <FontAwesomeIcon
                        icon={r.icono}
                        className="nav-result-icon"
                      />
                      <span className="nav-result-label">{r.label}</span>
                      <span className="nav-result-tag">{r.tipo}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="nav-user">
            <button
              className="nav-logout"
              onClick={onLogout}
              title="Cerrar sesión"
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
            </button>
          </div>
        </div>
      </header>

      {/* ===== CUERPO: sidebar + contenido ===== */}
      <div className="dash-body">
        <aside className="sidebar">
          <nav className="side-nav">
            {MENU.map((m) => (
              <button
                key={m.id}
                className={"side-link" + (seccion === m.id ? " active" : "")}
                onClick={() => irASeccion(m.id)}
              >
                <FontAwesomeIcon icon={m.icon} className="side-link-icon" />
                <span>{m.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="content">
          {/* El 'key' incluye el filtro: al elegir un resultado, la sección se
              remonta limpia y arranca con ese filtro ya aplicado. */}
          {seccion === "clientes" && (
            <PersonasSeccion
              key={`clientes:${filtroInicial}`}
              tipo="Cliente"
              titulo="Clientes"
              singular="cliente"
              icono={faUsers}
              filtroInicial={filtroInicial}
            />
          )}
          {seccion === "proveedores" && (
            <PersonasSeccion
              key={`proveedores:${filtroInicial}`}
              tipo="Proveedor"
              titulo="Proveedores"
              singular="proveedor"
              icono={faTruck}
              filtroInicial={filtroInicial}
            />
          )}
          {seccion === "categorias" && (
            <Categorias
              key={`categorias:${filtroInicial}`}
              filtroInicial={filtroInicial}
            />
          )}
          {seccion === "productos" && (
            <Productos
              key={`productos:${filtroInicial}`}
              filtroInicial={filtroInicial}
            />
          )}
          {seccion === "movimientos" && <Movimientos />}
        </main>
      </div>
    </div>
  );
}
