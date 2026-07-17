import { useState } from "react";
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
import PersonasSeccion from "./PersonasSeccion";
import Categorias from "./Categorias";
import Productos from "./Productos";
import Movimientos from "./Movimientos";
import "./Dashboard.css";

// Las secciones del sidebar. Agregar una nueva es solo sumar un objeto aquí.
const MENU = [
  { id: "clientes", label: "Clientes", icon: faUsers },
  { id: "proveedores", label: "Proveedores", icon: faTruck },
  { id: "categorias", label: "Categorías", icon: faTags },
  { id: "productos", label: "Productos", icon: faBoxOpen },
  {
    id: "movimientos",
    label: "Movimientos Diarios",
    icon: faMoneyBillTransfer,
  },
];

export default function Dashboard({ onLogout }) {
  // Qué sección se está viendo. Por ahora cada una muestra un placeholder;
  const [seccion, setSeccion] = useState("clientes");
  const [busqueda, setBusqueda] = useState("");

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
          <div className="nav-search">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="nav-search-icon"
            />
            <input
              type="text"
              placeholder="Buscar clientes, proveedores..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
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
                onClick={() => setSeccion(m.id)}
              >
                <FontAwesomeIcon icon={m.icon} className="side-link-icon" />
                <span>{m.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="content">
          {seccion === "clientes" && (
            <PersonasSeccion
              tipo="Cliente"
              titulo="Clientes"
              singular="cliente"
              icono={faUsers}
            />
          )}
          {seccion === "proveedores" && (
            <PersonasSeccion
              tipo="Proveedor"
              titulo="Proveedores"
              singular="proveedor"
              icono={faTruck}
            />
          )}
          {seccion === "categorias" && <Categorias />}
          {seccion === "productos" && <Productos />}
          {seccion === "movimientos" && <Movimientos />}
        </main>
      </div>
    </div>
  );
}
