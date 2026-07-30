// Helpers de fecha/formato compartidos por Informes.js e InformesComparativo.js.

export function mesActual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

export function mesPasado() {
  const h = new Date();
  const m = new Date(h.getFullYear(), h.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-07" -> ["2026-07-01", "2026-07-31"] (el día 0 del mes siguiente
// es el último día del mes elegido; truco clásico de la clase Date).
export function rangoDeMes(mes) {
  const [anio, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(anio, m, 0).getDate();
  return [`${mes}-01`, `${mes}-${String(ultimoDia).padStart(2, "0")}`];
}

export function fechaCorta(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// Formato de dinero (igual que el PDF: negativos entre paréntesis).
export const fmt = (v) =>
  Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const fmtSigno = (v) => (v < 0 ? `(${fmt(v)})` : fmt(v));
