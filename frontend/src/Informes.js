import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartPie,
  faFilePdf,
  faSpinner,
  faArrowTrendUp,
  faArrowTrendDown,
  faHashtag,
  faDollarSign,
  faPlus,
  faMinus,
} from "@fortawesome/free-solid-svg-icons";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { apiGet, apiGetBlob } from "./api";
import { mostrarError } from "./alertas";
import "./Crud.css";
import "./Informes.css";

// La MISMA paleta del PDF (validada para contraste): los colores significan
// lo mismo en pantalla y en papel. Verde/rojo es un par difícil para
// daltonismo, por eso las series SIEMPRE llevan leyenda y nombre al lado.
const VERDE = "#1FA35C";
const ROJO = "#D62828";
const NAVY = "#132F63";
const MORADO = "#7B3FA9";
const GRIS = "#64748B";
const COLOR_METODO = {
  Transferencia: "#1F6FEB",
  Efectivo: VERDE,
  Tarjeta: ROJO,
  Sinpe: MORADO,
};

// ---------- Fechas ----------
function mesActual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

function mesPasado() {
  const h = new Date();
  const m = new Date(h.getFullYear(), h.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-07" -> ["2026-07-01", "2026-07-31"] (el día 0 del mes siguiente
// es el último día del mes elegido; truco clásico de la clase Date).
function rangoDeMes(mes) {
  const [anio, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(anio, m, 0).getDate();
  return [`${mes}-01`, `${mes}-${String(ultimoDia).padStart(2, "0")}`];
}

function fechaCorta(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ---------- Formato de dinero (igual que el PDF: negativos entre paréntesis) ----------
const fmt = (v) =>
  Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtSigno = (v) => (v < 0 ? `(${fmt(v)})` : fmt(v));

// ---------- Variación vs período anterior ----------
// invertir=true para GASTOS: que suban es malo (rojo), que bajen es bueno.
function Delta({ actual, anterior, invertir = false, neutro = false }) {
  if (!anterior) {
    return <span className="inf-delta inf-delta-neutra">Sin período anterior</span>;
  }
  const pct = ((actual - anterior) / Math.abs(anterior)) * 100;
  const sube = pct >= 0;
  let clase = "inf-delta-neutra";
  if (!neutro) {
    const esBueno = invertir ? !sube : sube;
    clase = esBueno ? "inf-delta-buena" : "inf-delta-mala";
  }
  return (
    <span className={`inf-delta ${clase}`}>
      <FontAwesomeIcon icon={sube ? faArrowTrendUp : faArrowTrendDown} />{" "}
      {sube ? "+" : ""}
      {pct.toFixed(1)}% vs anterior
    </span>
  );
}

function Tarjeta({ icono, color, etiqueta, valor, children }) {
  return (
    <div className="inf-card">
      <span className="inf-card-icon" style={{ background: color }}>
        <FontAwesomeIcon icon={icono} />
      </span>
      <div className="inf-card-textos">
        <span className="inf-card-label">{etiqueta}</span>
        <span className="inf-card-valor" style={{ color }}>
          {valor}
        </span>
        {children}
      </div>
    </div>
  );
}

export default function Informes() {
  const [modo, setModo] = useState("mes"); // "mes" | "rango"
  const [mes, setMes] = useState(mesActual());
  const [desde, setDesde] = useState(rangoDeMes(mesActual())[0]);
  const [hasta, setHasta] = useState(rangoDeMes(mesActual())[1]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pdfCargando, setPdfCargando] = useState(false);

  // El rango que realmente se consulta, según el modo elegido.
  const [d, h] = modo === "mes" ? rangoDeMes(mes) : [desde, hasta];
  const rangoValido = d && h && d <= h;

  useEffect(() => {
    if (!rangoValido) return;
    let cancelado = false; // evita "pisar" la respuesta si cambian el filtro rápido
    (async () => {
      setCargando(true);
      setError("");
      try {
        const r = await apiGet(`/reportes/resumen/?desde=${d}&hasta=${h}`);
        if (!cancelado) setDatos(r);
      } catch (e) {
        if (!cancelado) setError(e.message);
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [d, h, rangoValido]);

  async function descargarPdf() {
    setPdfCargando(true);
    try {
      const blob = await apiGetBlob(`/reportes/resumen/pdf/?desde=${d}&hasta=${h}`);
      // Se abre en otra pestaña: desde ahí se puede imprimir o descargar.
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setPdfCargando(false);
    }
  }

  const tot = datos?.totales;
  const ant = datos?.anterior;
  const sinDatos = tot && tot.movimientos === 0;

  // Dona: la porción es el tamaño del movimiento (valor absoluto del neto),
  // igual que en el PDF, para que porciones y porcentajes coincidan.
  const datosDona = (datos?.por_metodo || [])
    .filter((m) => m.neto !== 0)
    .map((m) => ({ name: m.metodo, value: Math.abs(m.neto), neto: m.neto }));
  const movidoTotal = datosDona.reduce((s, x) => s + x.value, 0);

  return (
    <div>
      <div className="page-top">
        <div className="page-header">
          <FontAwesomeIcon icon={faChartPie} />
          <h1>Informes</h1>
        </div>
        <div className="page-actions">
          <button
            className="btn-primary"
            onClick={descargarPdf}
            disabled={!rangoValido || cargando || pdfCargando}
          >
            <FontAwesomeIcon icon={pdfCargando ? faSpinner : faFilePdf} spin={pdfCargando} />{" "}
            Descargar PDF
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* ===== Filtros de período (una sola fila, arriba de todo) ===== */}
      <div className="inf-filtros">
        <div className="inf-modo">
          <button
            className={modo === "mes" ? "activo" : ""}
            onClick={() => setModo("mes")}
          >
            Por mes
          </button>
          <button
            className={modo === "rango" ? "activo" : ""}
            onClick={() => setModo("rango")}
          >
            Rango libre
          </button>
        </div>

        {modo === "mes" ? (
          <>
            <input
              type="month"
              className="inf-input"
              value={mes}
              onChange={(e) => e.target.value && setMes(e.target.value)}
            />
            <button className="inf-atajo" onClick={() => setMes(mesActual())}>
              Este mes
            </button>
            <button className="inf-atajo" onClick={() => setMes(mesPasado())}>
              Mes pasado
            </button>
          </>
        ) : (
          <>
            <label className="inf-fecha-label">
              Desde
              <input
                type="date"
                className="inf-input"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <label className="inf-fecha-label">
              Hasta
              <input
                type="date"
                className="inf-input"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
          </>
        )}

        {datos && (
          <span className="inf-comparado">
            Comparado con {fechaCorta(ant.desde)} – {fechaCorta(ant.hasta)}
          </span>
        )}
      </div>

      {!rangoValido && (
        <div className="table-card">
          <div className="table-empty">
            La fecha "desde" debe ser anterior (o igual) a "hasta".
          </div>
        </div>
      )}

      {rangoValido && cargando && (
        <div className="table-card">
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Calculando informe...
          </div>
        </div>
      )}

      {rangoValido && !cargando && datos && (
        <>
          {/* ===== Tarjetas de totales ===== */}
          <div className="inf-cards">
            <Tarjeta icono={faPlus} color={VERDE} etiqueta="VENTAS TOTALES" valor={`$${fmt(tot.ventas)}`}>
              <Delta actual={tot.ventas} anterior={ant.ventas} />
            </Tarjeta>
            <Tarjeta icono={faMinus} color={ROJO} etiqueta="GASTOS TOTALES" valor={`$${fmt(tot.gastos)}`}>
              <Delta actual={tot.gastos} anterior={ant.gastos} invertir />
            </Tarjeta>
            <Tarjeta
              icono={faDollarSign}
              color={tot.neto < 0 ? ROJO : MORADO}
              etiqueta="RESULTADO NETO"
              valor={`$${fmtSigno(tot.neto)}`}
            >
              <Delta actual={tot.neto} anterior={ant.neto} />
            </Tarjeta>
            <Tarjeta icono={faHashtag} color={NAVY} etiqueta="MOVIMIENTOS" valor={tot.movimientos}>
              <Delta actual={tot.movimientos} anterior={ant.movimientos} neutro />
            </Tarjeta>
          </div>

          {sinDatos && (
            <div className="table-card">
              <div className="table-empty">
                No hay movimientos registrados en este período.
              </div>
            </div>
          )}

          {!sinDatos && (
            <>
              {/* ===== Evolución + dona ===== */}
              <div className="inf-charts">
                <div className="inf-box">
                  <h3 className="inf-box-titulo">
                    Evolución de ventas y gastos{" "}
                    <span className="inf-box-sub">
                      ({datos.serie.agrupacion === "dia" ? "por día" : "por mes"} · USD)
                    </span>
                  </h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={datos.serie.puntos} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e8eef6" vertical={false} />
                      <XAxis
                        dataKey="etiqueta"
                        tick={{ fontSize: 11, fill: GRIS }}
                        tickLine={false}
                        axisLine={{ stroke: "#d8e0ec" }}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: GRIS }}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                        tickFormatter={(v) => v.toLocaleString("en-US")}
                      />
                      <Tooltip formatter={(v) => `$${fmt(v)}`} />
                      <Legend />
                      <Line type="monotone" dataKey="ventas" name="Ventas" stroke={VERDE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="gastos" name="Gastos" stroke={ROJO} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="inf-box">
                  <h3 className="inf-box-titulo">
                    Distribución por método <span className="inf-box-sub">(neto · USD)</span>
                  </h3>
                  {datosDona.length === 0 ? (
                    <div className="table-empty">Sin montos en el período.</div>
                  ) : (
                    <div className="inf-dona-wrap">
                      {/* Tamaño fijo: dentro de un flex, un ancho en % se
                          encoge hasta desaparecer; 200px se ve siempre bien. */}
                      <ResponsiveContainer width={200} height={200}>
                        <PieChart>
                          <Pie
                            data={datosDona}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="55%"
                            outerRadius="90%"
                            stroke="#fff"
                            strokeWidth={2}
                            isAnimationActive={false}
                          >
                            {datosDona.map((x) => (
                              <Cell key={x.name} fill={COLOR_METODO[x.name]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, n, p) => `$${fmtSigno(p.payload.neto)}`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <table className="inf-leyenda">
                        <tbody>
                          {datos.por_metodo.map((m) => (
                            <tr key={m.metodo}>
                              <td>
                                <span
                                  className="inf-cuadro"
                                  style={{ background: COLOR_METODO[m.metodo] }}
                                />
                                {m.metodo}
                              </td>
                              <td className={m.neto < 0 ? "inf-rojo" : ""}>
                                ${fmtSigno(m.neto)}
                              </td>
                              <td className="inf-pct">
                                {movidoTotal
                                  ? ((Math.abs(m.neto) / movidoTotal) * 100).toFixed(1)
                                  : "0.0"}
                                %
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* ===== Métodos de pago: tabla completa ===== */}
              <div className="inf-box">
                <h3 className="inf-box-titulo">Métodos de pago</h3>
                <div className="inf-tabla-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Método</th>
                        <th>Movimientos</th>
                        <th>Ventas</th>
                        <th>Gastos</th>
                        <th>Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.por_metodo.map((m) => (
                        <tr key={m.metodo}>
                          <td>
                            <span
                              className="inf-cuadro"
                              style={{ background: COLOR_METODO[m.metodo] }}
                            />
                            {m.metodo}
                          </td>
                          <td>{m.movimientos}</td>
                          <td>${fmt(m.ventas)}</td>
                          <td className={m.gastos > 0 ? "inf-rojo" : ""}>
                            ${m.gastos > 0 ? `(${fmt(m.gastos)})` : fmt(m.gastos)}
                          </td>
                          <td className={m.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(m.neto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ===== Categorías: barras + tabla ===== */}
              <div className="inf-box">
                <h3 className="inf-box-titulo">
                  Resultado por categoría <span className="inf-box-sub">(USD)</span>
                </h3>
                <ResponsiveContainer
                  width="100%"
                  height={70 + datos.por_categoria.length * 44}
                >
                  <BarChart
                    layout="vertical"
                    data={datos.por_categoria}
                    margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#e8eef6" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: GRIS }}
                      tickLine={false}
                      axisLine={{ stroke: "#d8e0ec" }}
                      tickFormatter={(v) => v.toLocaleString("en-US")}
                    />
                    <YAxis
                      type="category"
                      dataKey="categoria"
                      width={130}
                      tick={{ fontSize: 12, fill: "#22304a" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip formatter={(v) => `$${fmt(v)}`} />
                    <Legend />
                    <Bar dataKey="ventas" name="Ventas" fill={VERDE} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    <Bar dataKey="gastos" name="Gastos" fill={ROJO} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>

                <div className="inf-tabla-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Categoría</th>
                        <th>Movimientos</th>
                        <th>Ventas</th>
                        <th>Gastos</th>
                        <th>Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.por_categoria.map((c) => (
                        <tr key={c.categoria}>
                          <td>{c.categoria}</td>
                          <td>{c.movimientos}</td>
                          <td>${fmt(c.ventas)}</td>
                          <td className={c.gastos > 0 ? "inf-rojo" : ""}>
                            ${c.gastos > 0 ? `(${fmt(c.gastos)})` : fmt(c.gastos)}
                          </td>
                          <td className={c.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(c.neto)}</td>
                        </tr>
                      ))}
                      <tr className="inf-fila-total">
                        <td>TOTALES</td>
                        <td>{tot.movimientos}</td>
                        <td>${fmt(tot.ventas)}</td>
                        <td className={tot.gastos > 0 ? "inf-rojo" : ""}>
                          ${tot.gastos > 0 ? `(${fmt(tot.gastos)})` : fmt(tot.gastos)}
                        </td>
                        <td className={tot.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(tot.neto)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
