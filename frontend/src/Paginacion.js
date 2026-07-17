import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";

/**
 * Controles de paginación reutilizables.
 *  - total:     cuántos registros hay en total (ya filtrados)
 *  - pagina:    página actual (empieza en 1)
 *  - porPagina: cuántas filas se muestran por página
 *  - onCambio:  función que recibe el número de la nueva página
 */
export default function Paginacion({ total, pagina, porPagina, onCambio }) {
  const totalPaginas = Math.ceil(total / porPagina);
  if (totalPaginas <= 1) return null; // con 1 sola página no hay nada que paginar

  // Rango visible: "1–10 de 43"
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  return (
    <div className="paginacion">
      <span className="paginacion-info">
        {desde}–{hasta} de {total}
      </span>
      <div className="paginacion-botones">
        <button
          className="paginacion-btn"
          disabled={pagina === 1}
          onClick={() => onCambio(pagina - 1)}
          aria-label="Página anterior"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        {/* Botón por cada página. Si algún día hay muchísimas, se cambia por "..." */}
        {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={"paginacion-btn" + (n === pagina ? " activa" : "")}
            onClick={() => onCambio(n)}
          >
            {n}
          </button>
        ))}
        <button
          className="paginacion-btn"
          disabled={pagina === totalPaginas}
          onClick={() => onCambio(pagina + 1)}
          aria-label="Página siguiente"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>
    </div>
  );
}
