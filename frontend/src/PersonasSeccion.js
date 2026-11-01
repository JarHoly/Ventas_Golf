import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faPen,
  faMagnifyingGlass,
  faSpinner,
  faFileExcel,
  faCalendarDay,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { apiGet, apiPost, apiPut, apiDelete, buscarCedula, esAdmin } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import Paginacion from "./Paginacion";
import { useOrden, ThOrden } from "./Ordenamiento";
import ModalOverlay from "./ModalOverlay";
import "./Crud.css";

const POR_PAGINA = 10;

// 2026-08-31 -> 31/08/2026
const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/**
 * Sección genérica de personas. Clientes y Proveedores son la MISMA pantalla
 * con distinto 'tipo', así que se comparte todo el código:
 *   <PersonasSeccion tipo="Cliente"   titulo="Clientes"    singular="cliente"   icono={faUsers} />
 *   <PersonasSeccion tipo="Proveedor" titulo="Proveedores" singular="proveedor" icono={faTruck} />
 *
 * Lo que cambia entre una y otra va por props, no por 'if' adentro:
 *  - 'etiquetaDoc': cómo se llama el documento de identidad en esta pantalla.
 *    En Clientes el negocio lo llama "Número de Socio"; en Proveedores sigue
 *    siendo la cédula. Es el MISMO campo de la base (Persona.cedula).
 *  - 'conMembresia': si la tabla muestra el vencimiento de la membresía
 *    (los proveedores no tienen membresía que mostrar).
 */
export default function PersonasSeccion({
  tipo,
  titulo,
  singular,
  icono,
  filtroInicial = "",
  etiquetaDoc = { th: "Cédula", largo: "Cédula", bajo: "cédula" },
  conMembresia = false,
}) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Puede venir pre-cargado desde la búsqueda global del navbar.
  const [busqueda, setBusqueda] = useState(filtroInicial);
  const [pagina, setPagina] = useState(1);
  // null = modal cerrado · {} = creando · {id,...} = editando ese registro
  const [enEdicion, setEnEdicion] = useState(null);
  // Persona a la que se le está ajustando el vencimiento (solo admin).
  const [ajustando, setAjustando] = useState(null);
  const { orden, cambiarOrden, ordenar } = useOrden();

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

  // Filtro: código, nombre, número de socio/cédula, teléfono o email.
  const texto = busqueda.trim().toLowerCase();
  const filtrados = texto
    ? items.filter((p) =>
        [p.codigo, p.nombre, p.cedula, p.telefono, p.email]
          .filter(Boolean)
          .some((campo) => campo.toLowerCase().includes(texto))
      )
    : items;

  // Paginación: recortamos solo las filas de la página actual (ya ordenadas).
  const ordenados = ordenar(filtrados, (p, campo) => p[campo]);
  const visibles = ordenados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function exportarExcel() {
    const filas = items.map((p) => {
      const fila = {
        Código: p.codigo,
        Nombre: p.nombre,
        [etiquetaDoc.largo]: p.cedula,
        Teléfono: p.telefono,
        Email: p.email,
      };
      // Mismas columnas que la pantalla: si la tabla muestra la membresía,
      // el Excel también (si no, el archivo no cuadra con lo que se ve).
      if (conMembresia) {
        fila["Membresía"] = p.membresia_producto || "";
        fila["Vence el"] = dmy(p.membresia_vence_el);
        fila["Estado membresía"] = p.membresia_estado;
        fila["Fecha fijada a mano"] = p.membresia_manual ? "Sí" : "";
      }
      return fila;
    });
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
          placeholder={`Buscar por código, nombre, ${etiquetaDoc.bajo}, teléfono o email...`}
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
                <ThOrden campo="codigo" orden={orden} onClick={cambiarOrden}>Código</ThOrden>
                <ThOrden campo="nombre" orden={orden} onClick={cambiarOrden}>Nombre</ThOrden>
                {/* El th usa la etiqueta CORTA: en móvil la columna es
                    angosta y "Número de Socio" se partiría en tres renglones. */}
                <ThOrden campo="cedula" orden={orden} onClick={cambiarOrden}>
                  {etiquetaDoc.th}
                </ThOrden>
                <th>Teléfono</th>
                <th>Email</th>
                {conMembresia && (
                  <ThOrden campo="membresia_vence_el" orden={orden} onClick={cambiarOrden}>
                    Membresía
                  </ThOrden>
                )}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td className="codigo-cell">{p.codigo}</td>
                  <td>{p.nombre}</td>
                  <td>{p.cedula}</td>
                  <td>{p.telefono || "-"}</td>
                  <td>{p.email || "-"}</td>
                  {conMembresia && (
                    <td>
                      <CeldaMembresia
                        persona={p}
                        onAjustar={() => setAjustando(p)}
                      />
                    </td>
                  )}
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
          etiquetaDoc={etiquetaDoc}
          existente={enEdicion.id ? enEdicion : null}
          onClose={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            cargar();
          }}
        />
      )}

      {ajustando && (
        <VencimientoForm
          persona={ajustando}
          onClose={() => setAjustando(null)}
          onGuardado={() => {
            setAjustando(null);
            cargar(); // la fecha de la tabla cambió
          }}
        />
      )}
    </div>
  );
}

// ===== Celda de membresía: vencimiento + estado + acceso al ajuste =====
function CeldaMembresia({ persona, onAjustar }) {
  if (!persona.membresia_vence_el) {
    return <span className="memb-sin">Sin membresía</span>;
  }
  const vencida = persona.membresia_estado === "Vencida";
  return (
    <span className="memb-celda">
      <span className={"badge-memb" + (vencida ? " vencida" : "")}>
        {vencida ? "Venció" : "Vence"} {dmy(persona.membresia_vence_el)}
      </span>
      {/* Una fecha que no coincide con el cálculo tiene que explicarse sola. */}
      {persona.membresia_manual && (
        <span className="memb-manual" title="Fecha fijada a mano por un administrador">
          manual
        </span>
      )}
      {esAdmin() && (
        <button
          className="btn-icon-edit"
          onClick={onAjustar}
          title="Cambiar la fecha de vencimiento (caso especial)"
        >
          <FontAwesomeIcon icon={faCalendarDay} />
        </button>
      )}
    </span>
  );
}

// ===== Modal del CASO ESPECIAL: fijar el vencimiento a mano (solo admin) =====
function VencimientoForm({ persona, onClose, onGuardado }) {
  const [vence, setVence] = useState(persona.membresia_vence_el || "");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState("");
  // Estado completo (incluye el motivo del ajuste anterior, si hubo uno).
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    apiGet(`/membresias/estado/?persona=${persona.id}&fecha=${new Date().toISOString().slice(0, 10)}`)
      .then(setEstado)
      .catch(() => setEstado(null));
  }, [persona.id]);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await apiPut(`/personas/${persona.id}/membresia/`, { vence_el: vence, motivo });
      avisoExito("Vencimiento actualizado");
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  async function volverAlCalculo() {
    setQuitando(true);
    setError("");
    try {
      await apiDelete(`/personas/${persona.id}/membresia/`);
      avisoExito("Se volvió a la fecha calculada");
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setQuitando(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          Vencimiento de la membresía
          <span className="modal-fecha">{persona.nombre}</span>
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <div className="aviso-carrito neutro">
          <FontAwesomeIcon icon={faCalendarDay} />
          <span>
            Tiene <b>{persona.membresia_producto}</b>, vence el{" "}
            <b>{dmy(persona.membresia_vence_el)}</b>.
            {estado?.tiene_membresia && (
              <>
                {" "}
                Lleva {estado.usos_consumidos} de {estado.usos_incluidos} usos de
                carrito en este período.
              </>
            )}
          </span>
        </div>

        {estado?.ajuste_manual && (
          <p className="form-hint">
            Ya tiene una fecha fijada a mano
            {estado.ajustada_por ? ` por ${estado.ajustada_por}` : ""}
            {estado.ajustada_en
              ? ` el ${new Date(estado.ajustada_en).toLocaleDateString("es-CR")}`
              : ""}
            : "{estado.ajuste_motivo}".
          </p>
        )}

        <form onSubmit={guardar}>
          <label className="form-label">Nueva fecha de vencimiento</label>
          <input
            className="form-input"
            type="date"
            value={vence}
            onChange={(e) => setVence(e.target.value)}
            required
            autoFocus
          />

          <label className="form-label">Motivo del cambio</label>
          <textarea
            className="form-input obs-textarea"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: convenio con el socio por el cierre de la cancha en setiembre."
            required
          />
          <p className="form-hint">
            Esta fecha <b>manda sobre el cálculo automático</b> y se conserva: si
            el cliente renueva, los días de la renovación se suman sobre ella.
            Queda guardado quién la cambió, cuándo y por qué.
          </p>

          <div className="modal-actions">
            {estado?.ajuste_manual && (
              <button
                type="button"
                className="btn-ghost"
                onClick={volverAlCalculo}
                disabled={quitando || guardando}
                title="Quitar el ajuste y volver a la fecha que calcula el sistema"
              >
                <FontAwesomeIcon icon={faRotateLeft} />{" "}
                {quitando ? "Quitando..." : "Volver al cálculo"}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando || quitando}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// ===== Formulario para crear O editar una persona (en un modal) =====
function PersonaForm({ tipo, singular, etiquetaDoc, existente, onClose, onGuardado }) {
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
    <ModalOverlay onClose={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {editando ? `Editar ${singular}` : `Nuevo ${singular}`}
        </h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">{etiquetaDoc.largo}</label>
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
            Escribí el número de cédula y tocá la lupa para traer el nombre del
            padrón.
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
    </ModalOverlay>
  );
}
