import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowTrendUp,
  faArrowTrendDown,
} from "@fortawesome/free-solid-svg-icons";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { apiGet } from "./api";
import { mesActual, mesPasado, rangoDeMes, fechaCorta, fmt, fmtSigno } from "./fechasInforme";
import "./Crud.css";
import "./Informes.css";

const VERDE = "#1FA35C";
const VERDE_CLARO = "#8FD8AE";
const ROJO = "#D62828";
const ROJO_CLARO = "#F0A3A3";
const NAVY = "#132F63";
const NAVY_CLARO = "#8FA3C9";
const MORADO = "#7B3FA9";
const GRIS = "#64748B";
const COLOR_METODO = { Transferencia: "#1F6FEB", Efectivo: VERDE, Tarjeta: ROJO, Sinpe: MORADO };
const METODOS = ["Transferencia", "Efectivo", "Tarjeta", "Sinpe"];

// Variación de B contra A (A es la base de comparación, B lo que se evalúa).
function variacion(b, a) {
  if (!a) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

function Delta({ b, a, invertir = false, grande = false }) {
  const pct = variacion(b, a);
  if (pct === null) {
    return <span className="inf-delta inf-delta-neutra">Sin datos en A</span>;
  }
  const sube = pct >= 0;
  const esBueno = invertir ? !sube : sube;
  return (
    <span className={`inf-delta ${esBueno ? "inf-delta-buena" : "inf-delta-mala"}${grande ? " inf-delta-grande" : ""}`}>
      <FontAwesomeIcon icon={sube ? faArrowTrendUp : faArrowTrendDown} />{" "}
      {sube ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

// Mezcla dos listas (por_metodo o por_categoria) por su clave, conservando
// las filas que solo estén en uno de los dos lados (con ceros del otro).
function mezclarPorClave(listaA, listaB, clave) {
  const orden = [];
  const mapa = new Map();
  for (const item of listaA || []) {
    orden.push(item[clave]);
    mapa.set(item[clave], { a: item, b: null });
  }
  for (const item of listaB || []) {
    const existente = mapa.get(item[clave]);
    if (existente) existente.b = item;
    else {
      orden.push(item[clave]);
      mapa.set(item[clave], { a: null, b: item });
    }
  }
  return orden.map((k) => ({ clave: k, ...mapa.get(k) }));
}

const CERO = { ventas: 0, gastos: 0, neto: 0, ventas_crc: 0, gastos_crc: 0, neto_crc: 0, cantidad: 0 };

// Tarjeta "duelo": dos barras horizontales (A vs B) a escala, con la
// variación grande al lado. Mismo color, dos tonos: A es el tono claro (la
// base), B el tono fuerte (lo que se evalúa) — así se ve de un vistazo cuál
// creció y cuánto, sin tener que leer los números.
function TarjetaDuelo({ etiqueta, colorClaro, colorFuerte, valorA, valorB, invertir = false }) {
  const max = Math.max(Math.abs(valorA), Math.abs(valorB), 1);
  const anchoA = (Math.abs(valorA) / max) * 100;
  const anchoB = (Math.abs(valorB) / max) * 100;
  return (
    <div className="inf-card inf-duelo">
      <div className="inf-duelo-header">
        <span className="inf-card-label">{etiqueta}</span>
        <Delta b={valorB} a={valorA} invertir={invertir} grande />
      </div>
      <div className="inf-duelo-fila">
        <span className="inf-duelo-tag">A</span>
        <div className="inf-duelo-track">
          <div className="inf-duelo-barra" style={{ width: `${anchoA}%`, background: colorClaro }} />
        </div>
        <span className="inf-duelo-num">${fmtSigno(valorA)}</span>
      </div>
      <div className="inf-duelo-fila">
        <span className="inf-duelo-tag b">B</span>
        <div className="inf-duelo-track">
          <div className="inf-duelo-barra" style={{ width: `${anchoB}%`, background: colorFuerte }} />
        </div>
        <span className="inf-duelo-num">${fmtSigno(valorB)}</span>
      </div>
    </div>
  );
}

// Dona chica de distribución por método (para un solo período).
function DonaMetodo({ etiqueta, datos }) {
  const puntos = METODOS.map((m) => ({ name: m, value: Math.abs(datos?.[m] || 0) }))
    .filter((p) => p.value > 0);
  const total = puntos.reduce((s, p) => s + p.value, 0);
  return (
    <div className="inf-dona-mini">
      <span className="inf-dona-mini-titulo">{etiqueta}</span>
      {puntos.length === 0 ? (
        <div className="inf-dona-mini-vacia">Sin movimientos</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <PieChart>
            <Pie
              data={puntos}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="90%"
              stroke="#fff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {puntos.map((p) => (
                <Cell key={p.name} fill={COLOR_METODO[p.name]} />
              ))}
            </Pie>
            <Tooltip formatter={(v, n) => [`$${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Selector de un período (mes o rango libre) — se usa dos veces, una por lado.
function SelectorPeriodo({ etiqueta, modo, setModo, mes, setMes, desde, setDesde, hasta, setHasta }) {
  return (
    <div className="inf-box" style={{ marginBottom: 0 }}>
      <h3 className="inf-box-titulo">{etiqueta}</h3>
      <div className="inf-filtros" style={{ marginBottom: 0 }}>
        <div className="inf-modo">
          <button className={modo === "mes" ? "activo" : ""} onClick={() => setModo("mes")}>
            Por mes
          </button>
          <button className={modo === "rango" ? "activo" : ""} onClick={() => setModo("rango")}>
            Rango libre
          </button>
        </div>
        {modo === "mes" ? (
          <input
            type="month"
            className="inf-input"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
          />
        ) : (
          <>
            <label className="inf-fecha-label">
              Desde
              <input type="date" className="inf-input" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="inf-fecha-label">
              Hasta
              <input type="date" className="inf-input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export default function InformesComparativo() {
  // Período A (la base) y Período B (lo que se compara contra A).
  const [modoA, setModoA] = useState("mes");
  const [mesA, setMesA] = useState(mesPasado());
  const [desdeA, setDesdeA] = useState(rangoDeMes(mesPasado())[0]);
  const [hastaA, setHastaA] = useState(rangoDeMes(mesPasado())[1]);

  const [modoB, setModoB] = useState("mes");
  const [mesB, setMesB] = useState(mesActual());
  const [desdeB, setDesdeB] = useState(rangoDeMes(mesActual())[0]);
  const [hastaB, setHastaB] = useState(rangoDeMes(mesActual())[1]);

  const [datosA, setDatosA] = useState(null);
  const [datosB, setDatosB] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [dA, hA] = modoA === "mes" ? rangoDeMes(mesA) : [desdeA, hastaA];
  const [dB, hB] = modoB === "mes" ? rangoDeMes(mesB) : [desdeB, hastaB];
  const validoA = dA && hA && dA <= hA;
  const validoB = dB && hB && dB <= hB;

  useEffect(() => {
    if (!validoA || !validoB) return;
    let cancelado = false;
    (async () => {
      setCargando(true);
      setError("");
      try {
        const [ra, rb] = await Promise.all([
          apiGet(`/reportes/resumen/?desde=${dA}&hasta=${hA}`),
          apiGet(`/reportes/resumen/?desde=${dB}&hasta=${hB}`),
        ]);
        if (!cancelado) {
          setDatosA(ra);
          setDatosB(rb);
        }
      } catch (e) {
        if (!cancelado) setError(e.message);
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dA, hA, dB, hB, validoA, validoB]);

  const hayCrc = Boolean(datosA?.hay_crc || datosB?.hay_crc);
  const porMetodo = datosA && datosB ? mezclarPorClave(datosA.por_metodo, datosB.por_metodo, "metodo") : [];
  const porCategoria = datosA && datosB ? mezclarPorClave(datosA.por_categoria, datosB.por_categoria, "categoria") : [];

  // Datos para el gráfico de barras agrupadas (categorías por neto).
  const datosBarras = [...porCategoria]
    .map((f) => ({
      categoria: f.clave,
      "Neto A": (f.a || CERO).neto,
      "Neto B": (f.b || CERO).neto,
    }))
    .sort((x, y) => Math.abs(y["Neto B"]) - Math.abs(x["Neto B"]))
    .slice(0, 8);

  const netoPorMetodoA = {};
  const netoPorMetodoB = {};
  for (const m of METODOS) {
    netoPorMetodoA[m] = (porMetodo.find((f) => f.clave === m)?.a || CERO).neto;
    netoPorMetodoB[m] = (porMetodo.find((f) => f.clave === m)?.b || CERO).neto;
  }

  return (
    <div>
      <div className="inf-charts" style={{ marginBottom: 16 }}>
        <SelectorPeriodo
          etiqueta="Período A (base)"
          modo={modoA} setModo={setModoA}
          mes={mesA} setMes={setMesA}
          desde={desdeA} setDesde={setDesdeA}
          hasta={hastaA} setHasta={setHastaA}
        />
        <SelectorPeriodo
          etiqueta="Período B (a comparar)"
          modo={modoB} setModo={setModoB}
          mes={mesB} setMes={setMesB}
          desde={desdeB} setDesde={setDesdeB}
          hasta={hastaB} setHasta={setHastaB}
        />
      </div>

      <p className="inf-comparado" style={{ marginBottom: 16 }}>
        A: {fechaCorta(dA)} – {fechaCorta(hA)} &nbsp;→&nbsp; B: {fechaCorta(dB)} – {fechaCorta(hB)}
      </p>

      {error && <div className="alert-error">{error}</div>}

      {(!validoA || !validoB) && (
        <div className="table-card">
          <div className="table-empty">En cada período, "desde" debe ser anterior (o igual) a "hasta".</div>
        </div>
      )}

      {validoA && validoB && cargando && (
        <div className="table-card">
          <div className="table-empty">
            <FontAwesomeIcon icon={faSpinner} spin /> Calculando comparativo...
          </div>
        </div>
      )}

      {validoA && validoB && !cargando && datosA && datosB && (
        <>
          <div className="inf-cards">
            <TarjetaDuelo
              etiqueta="VENTAS (USD)"
              colorClaro={VERDE_CLARO} colorFuerte={VERDE}
              valorA={datosA.totales.ventas} valorB={datosB.totales.ventas}
            />
            <TarjetaDuelo
              etiqueta="GASTOS (USD)"
              colorClaro={ROJO_CLARO} colorFuerte={ROJO}
              valorA={datosA.totales.gastos} valorB={datosB.totales.gastos}
              invertir
            />
            <TarjetaDuelo
              etiqueta="NETO (USD)"
              colorClaro={NAVY_CLARO} colorFuerte={datosB.totales.neto < 0 ? ROJO : NAVY}
              valorA={datosA.totales.neto} valorB={datosB.totales.neto}
            />
          </div>

          <div className="inf-box">
            <h3 className="inf-box-titulo">Movimientos</h3>
            <p>
              A: <b>{datosA.totales.movimientos}</b> ({datosA.totales.cantidad} unidades) &nbsp;·&nbsp;
              B: <b>{datosB.totales.movimientos}</b> ({datosB.totales.cantidad} unidades)
            </p>
          </div>

          {/* ===== Gráficos: la parte "visual" del comparativo ===== */}
          <div className="inf-charts">
            <div className="inf-box">
              <h3 className="inf-box-titulo">
                Neto por categoría <span className="inf-box-sub">(A vs B, USD, top 8)</span>
              </h3>
              {datosBarras.length === 0 ? (
                <div className="table-empty">Sin categorías en ninguno de los dos períodos.</div>
              ) : (
                <ResponsiveContainer width="100%" height={70 + datosBarras.length * 40}>
                  <BarChart
                    layout="vertical"
                    data={datosBarras}
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
                      width={120}
                      tick={{ fontSize: 12, fill: "#22304a" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip formatter={(v) => `$${fmtSigno(v)}`} />
                    <Legend />
                    <Bar dataKey="Neto A" fill={NAVY_CLARO} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    <Bar dataKey="Neto B" fill={NAVY} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="inf-box">
              <h3 className="inf-box-titulo">Distribución por método (neto)</h3>
              <div className="inf-dona-duo">
                <DonaMetodo etiqueta="Período A" datos={netoPorMetodoA} />
                <DonaMetodo etiqueta="Período B" datos={netoPorMetodoB} />
              </div>
              <div className="inf-dona-duo-leyenda">
                {METODOS.map((m) => (
                  <span key={m} className="inf-cuadro-item">
                    <span className="inf-cuadro" style={{ background: COLOR_METODO[m] }} />
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="inf-box">
            <h3 className="inf-box-titulo">Comparativo por método de pago (detalle)</h3>
            <div className="inf-tabla-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Método</th>
                    <th>Ventas A</th>
                    <th>Ventas B</th>
                    <th>Gastos A</th>
                    <th>Gastos B</th>
                    <th>Neto A</th>
                    <th>Neto B</th>
                    <th>Variación neto</th>
                  </tr>
                </thead>
                <tbody>
                  {porMetodo.map((fila) => {
                    const a = fila.a || CERO;
                    const b = fila.b || CERO;
                    return (
                      <tr key={fila.clave}>
                        <td>{fila.clave}</td>
                        <td>${fmt(a.ventas)}</td>
                        <td>${fmt(b.ventas)}</td>
                        <td className={a.gastos > 0 ? "inf-rojo" : ""}>${fmt(a.gastos)}</td>
                        <td className={b.gastos > 0 ? "inf-rojo" : ""}>${fmt(b.gastos)}</td>
                        <td className={a.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(a.neto)}</td>
                        <td className={b.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(b.neto)}</td>
                        <td>
                          <Delta b={b.neto} a={a.neto} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="inf-box">
            <h3 className="inf-box-titulo">
              Comparativo por categoría (detalle) <span className="inf-box-sub">(USD{hayCrc ? " y CRC" : ""})</span>
            </h3>
            <div className="inf-tabla-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Cantidad A</th>
                    <th>Cantidad B</th>
                    <th>Ventas A ($)</th>
                    <th>Ventas B ($)</th>
                    <th>Gastos A ($)</th>
                    <th>Gastos B ($)</th>
                    <th>Neto A ($)</th>
                    <th>Neto B ($)</th>
                    <th>Variación neto</th>
                    {hayCrc && (
                      <>
                        <th>Neto A (₡)</th>
                        <th>Neto B (₡)</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {porCategoria.length === 0 ? (
                    <tr>
                      <td colSpan={hayCrc ? 12 : 10}>Sin categorías en ninguno de los dos períodos.</td>
                    </tr>
                  ) : (
                    porCategoria.map((fila) => {
                      const a = fila.a || CERO;
                      const b = fila.b || CERO;
                      return (
                        <tr key={fila.clave}>
                          <td>{fila.clave}</td>
                          <td>{a.cantidad}</td>
                          <td>{b.cantidad}</td>
                          <td>${fmt(a.ventas)}</td>
                          <td>${fmt(b.ventas)}</td>
                          <td className={a.gastos > 0 ? "inf-rojo" : ""}>${fmt(a.gastos)}</td>
                          <td className={b.gastos > 0 ? "inf-rojo" : ""}>${fmt(b.gastos)}</td>
                          <td className={a.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(a.neto)}</td>
                          <td className={b.neto < 0 ? "inf-rojo" : ""}>${fmtSigno(b.neto)}</td>
                          <td>
                            <Delta b={b.neto} a={a.neto} />
                          </td>
                          {hayCrc && (
                            <>
                              <td className={a.neto_crc < 0 ? "inf-rojo" : ""}>₡{fmtSigno(a.neto_crc)}</td>
                              <td className={b.neto_crc < 0 ? "inf-rojo" : ""}>₡{fmtSigno(b.neto_crc)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
