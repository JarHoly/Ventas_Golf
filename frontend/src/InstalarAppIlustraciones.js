// Ilustraciones simples (SVG, sin imágenes externas) para el tutorial de
// instalación en iOS. Muestran un teléfono genérico con el paso resaltado,
// para que el tutorial se sienta visual en vez de una lista de texto plano.

const NAVY = "#132f63";
const GREEN = "#1fa35c";
const GRIS = "#cbd5e1";
const GRIS_CLARO = "#eef2f7";

// Marco de teléfono reutilizable: todo lo que cambia entre pasos va DENTRO
// (como children), sobre la "pantalla" blanca.
function MarcoCelular({ children }) {
  return (
    <svg viewBox="0 0 160 220" width="140" height="192" role="img" aria-hidden="true">
      <rect x="4" y="4" width="152" height="212" rx="18" fill={NAVY} />
      <rect x="12" y="16" width="136" height="188" rx="8" fill="#fff" />
      <rect x="60" y="9" width="40" height="5" rx="2.5" fill="#33477a" />
      {children}
    </svg>
  );
}

export function IlustracionCompartir() {
  return (
    <MarcoCelular>
      {/* Barra superior de Safari con el ícono de compartir resaltado */}
      <rect x="12" y="16" width="136" height="26" fill={GRIS_CLARO} />
      <circle cx="80" cy="29" r="13" fill={GREEN} />
      <path d="M80 22v13M80 22l-4.5 4.5M80 22l4.5 4.5M73 33v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V33"
        stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="80" cy="29" r="17" fill="none" stroke={GREEN} strokeWidth="1.5" opacity="0.4" />
      {/* Contenido de la página, atenuado, solo de relleno */}
      <rect x="24" y="56" width="112" height="8" rx="4" fill={GRIS} />
      <rect x="24" y="70" width="80" height="8" rx="4" fill={GRIS} />
      <rect x="24" y="94" width="112" height="50" rx="6" fill={GRIS_CLARO} />
    </MarcoCelular>
  );
}

export function IlustracionAgregar() {
  return (
    <MarcoCelular>
      <rect x="24" y="30" width="112" height="8" rx="4" fill={GRIS} />
      <rect x="24" y="44" width="80" height="8" rx="4" fill={GRIS} />
      {/* Hoja de opciones deslizada desde abajo, con "Agregar a inicio" resaltado */}
      <rect x="12" y="100" width="136" height="104" rx="12" fill={GRIS_CLARO} />
      <rect x="24" y="112" width="112" height="26" rx="8" fill="#fff" stroke={GRIS} />
      <rect x="24" y="146" width="112" height="26" rx="8" fill={GREEN} />
      <rect x="34" y="155" width="9" height="9" rx="2" fill="#fff" />
      <rect x="50" y="155" width="60" height="9" rx="4" fill="#fff" />
      <rect x="24" y="180" width="112" height="18" rx="8" fill="#fff" stroke={GRIS} />
    </MarcoCelular>
  );
}

export function IlustracionConfirmar() {
  return (
    <MarcoCelular>
      {/* Grilla de íconos de la pantalla de inicio */}
      {[0, 1, 2].map((fila) =>
        [0, 1, 2].map((col) => {
          const cx = 36 + col * 44;
          const cy = 40 + fila * 44;
          const esNuevo = fila === 1 && col === 1;
          return (
            <g key={`${fila}-${col}`}>
              <rect x={cx - 15} y={cy - 15} width="30" height="30" rx="8" fill={esNuevo ? NAVY : GRIS_CLARO} />
              {esNuevo && <circle cx={cx} cy={cy - 2} r="8" fill="#fff" />}
              {esNuevo && <circle cx={cx} cy={cy + 8} r="6" fill={GREEN} />}
            </g>
          );
        })
      )}
      <circle cx="80" cy="40" r="24" fill="none" stroke={GREEN} strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="98" cy="22" r="10" fill={GREEN} />
      <path d="M93 22l3.5 3.5L103 18" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </MarcoCelular>
  );
}
