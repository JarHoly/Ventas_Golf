import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSort, faSortUp, faSortDown } from "@fortawesome/free-solid-svg-icons";

// Orden de columnas reutilizable para las tablas de CRUD (Clientes, Productos,
// Categorías...): un clic en el encabezado ordena ascendente, otro clic
// invierte, y un clic en otra columna cambia de campo (vuelve a ascendente).
export function useOrden(campoInicial = null) {
  const [orden, setOrden] = useState({ campo: campoInicial, dir: "asc" });

  function cambiarOrden(campo) {
    setOrden((actual) =>
      actual.campo === campo
        ? { campo, dir: actual.dir === "asc" ? "desc" : "asc" }
        : { campo, dir: "asc" }
    );
  }

  function ordenar(items, obtenerValor) {
    if (!orden.campo) return items;
    const signo = orden.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      let va = obtenerValor(a, orden.campo);
      let vb = obtenerValor(b, orden.campo);
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // los vacíos van al final, en cualquier dirección
      if (vb == null) return -1;
      if (va < vb) return -1 * signo;
      if (va > vb) return 1 * signo;
      return 0;
    });
  }

  return { orden, cambiarOrden, ordenar };
}

// Encabezado <th> clicable con la flechita de orden actual.
export function ThOrden({ campo, orden, onClick, children }) {
  const activo = orden.campo === campo;
  const icono = activo ? (orden.dir === "asc" ? faSortUp : faSortDown) : faSort;
  return (
    <th className="th-ordenable" onClick={() => onClick(campo)}>
      {children}
      <FontAwesomeIcon icon={icono} className={"th-orden-icono" + (activo ? " activo" : "")} />
    </th>
  );
}
