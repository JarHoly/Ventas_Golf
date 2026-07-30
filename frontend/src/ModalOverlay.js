import { useRef } from "react";

// Fondo oscuro de los modales. Cierra al hacer clic AFUERA del modal, pero
// con un cuidado extra: si el mousedown arrancó DENTRO del modal (ej.
// seleccionando texto) y el mouseup terminó afuera por arrastre, el navegador
// igual dispara un "click" sobre este fondo — y sin este control, el modal
// se cerraba solo por soltar el mouse fuera sin querer. Por eso solo cierra
// si el clic ENTERO (mousedown Y mouseup) ocurrió sobre el fondo.
export default function ModalOverlay({ onClose, children, className = "" }) {
  const mouseDownEnFondo = useRef(false);

  function alPresionar(e) {
    mouseDownEnFondo.current = e.target === e.currentTarget;
  }

  function alHacerClic(e) {
    if (mouseDownEnFondo.current && e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className={"modal-overlay" + (className ? ` ${className}` : "")}
      onMouseDown={alPresionar}
      onClick={alHacerClic}
    >
      {children}
    </div>
  );
}
