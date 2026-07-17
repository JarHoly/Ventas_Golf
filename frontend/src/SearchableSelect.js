import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import "./SearchableSelect.css";

/**
 * Select con búsqueda: escribís y va filtrando las opciones para elegir.
 *  - opciones: [{ id, label }]
 *  - valor:    el id seleccionado ("" = nada)
 *  - onChange: recibe el id nuevo ("" si se limpia)
 */
export default function SearchableSelect({ opciones, valor, onChange, placeholder }) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef(null);

  const seleccionada = opciones.find((o) => String(o.id) === String(valor));

  // Cerrar el desplegable al hacer clic fuera del componente.
  useEffect(() => {
    function clicFuera(e) {
      if (cajaRef.current && !cajaRef.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", clicFuera);
    return () => document.removeEventListener("mousedown", clicFuera);
  }, []);

  const filtro = texto.trim().toLowerCase();
  const coincidencias = filtro
    ? opciones.filter((o) => o.label.toLowerCase().includes(filtro))
    : opciones;

  function elegir(opcion) {
    onChange(opcion.id);
    setTexto("");
    setAbierto(false);
  }

  function limpiar() {
    onChange("");
    setTexto("");
  }

  return (
    <div className="combobox" ref={cajaRef}>
      <div className="combobox-caja">
        <input
          className="form-input"
          // Cerrado: muestra la opción elegida. Abierto: lo que se va escribiendo.
          value={abierto ? texto : seleccionada?.label || ""}
          placeholder={seleccionada ? seleccionada.label : placeholder}
          onFocus={() => {
            setAbierto(true);
            setTexto("");
          }}
          onChange={(e) => setTexto(e.target.value)}
        />
        {seleccionada ? (
          <button type="button" className="combobox-limpiar" onClick={limpiar} title="Quitar selección">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        ) : (
          <span className="combobox-flecha">
            <FontAwesomeIcon icon={faChevronDown} />
          </span>
        )}
      </div>

      {abierto && (
        <div className="combobox-lista">
          {coincidencias.length === 0 ? (
            <div className="combobox-vacio">Sin resultados para "{texto}"</div>
          ) : (
            // Mostramos máximo 30 para que la lista no sea eterna.
            coincidencias.slice(0, 30).map((o) => (
              <button
                type="button"
                key={o.id}
                className={
                  "combobox-opcion" +
                  (String(o.id) === String(valor) ? " elegida" : "")
                }
                onClick={() => elegir(o)}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
