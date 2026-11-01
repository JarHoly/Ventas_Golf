import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faWarehouse,
  faPlus,
  faTrash,
  faSpinner,
  faFileExcel,
  faFilePdf,
  faCircleInfo,
  faTriangleExclamation,
  faSliders,
  faMagnifyingGlass,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { apiGet, apiPost, apiDelete, apiGetBlob } from "./api";
import { confirmarEliminar, mostrarError, avisoExito } from "./alertas";
import { mesActual, mesPasado, rangoDeMes, fechaCorta } from "./fechasInforme";
import SearchableSelect from "./SearchableSelect";
import ModalOverlay from "./ModalOverlay";
import Paginacion from "./Paginacion";
import { useOrden, ThOrden } from "./Ordenamiento";
import "./Crud.css";
import "./Informes.css";
import "./Movimientos.css";
import "./Inventario.css";

const POR_PAGINA = 12;
const TIPOS_AJUSTE = [
  { valor: "Inicial", label: "Inventario inicial", ayuda: "Lo que ya había en bodega antes de usar el sistema." },
  { valor: "Entrada", label: "Entrada (sobrante, devolución)", ayuda: "Suma unidades que no vinieron de una compra." },
  { valor: "Salida", label: "Salida (merma, rotura, consumo)", ayuda: "Resta unidades que no se vendieron." },
];

const hoy = () => new Date().toISOString().slice(0, 10);

// 3 -> "3" · 4.125 -> "4.13" · null -> "-"
const num = (v) => {
  if (v === null || v === undefined) return "-";
  return Number.isInteger(v) ? String(v) : Number(v).toFixed(2);
};

/**
 * MÓDULO DE INVENTARIO.
 *
 * Dos pantallas:
 *  - Existencias y rotación: el reporte del período (lo que hay, lo que se
 *    movió, cada cuánto conviene reponer). Exporta a Excel y a PDF.
 *  - Ajustes: inventario inicial, mermas y conteos físicos.
 *
 * Las COMPRAS no se registran acá: son movimientos de tipo Gasto en
 * "Movimientos Diarios" (así entran al PDF del día y a los gastos del
 * informe). Lo único que tiene que estar es el producto marcado como
 * "Controla inventario" en su ficha.
 */
export default function Inventario() {
  const [vista, setVista] = useState("existencias"); // "existencias" | "ajustes"

  return (
    <div>
      <div className="page-header page-header-solo">
        <FontAwesomeIcon icon={faWarehouse} />
        <h1>Inventario</h1>
      </div>

      <div className="inf-modo" style={{ marginBottom: 16 }}>
        <button
          className={vista === "existencias" ? "activo" : ""}
          onClick={() => setVista("existencias")}
        >
          Existencias y rotación
        </button>
        <button
          className={vista === "ajustes" ? "activo" : ""}
          onClick={() => setVista("ajustes")}
        >
          Ajustes
        </button>
      </div>

      {vista === "existencias" ? <Existencias /> : <Ajustes />}
    </div>
  );
}

// ======================================================================
// EXISTENCIAS Y ROTACIÓN
// ======================================================================
function Existencias() {
  const [modo, setModo] = useState("mes"); // "mes" | "rango"
  const [mes, setMes] = useState(mesActual());
  const [desde, setDesde] = useState(rangoDeMes(mesActual())[0]);
  const [hasta, setHasta] = useState(rangoDeMes(mesActual())[1]);
  // Horizonte de la sugerencia de compra: "¿cuánto necesito para N días?".
  const [diasObjetivo, setDiasObjetivo] = useState(30);
  const [busqueda, setBusqueda] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pdfCargando, setPdfCargando] = useState(false);
  const [pagina, setPagina] = useState(1);
  const { orden, cambiarOrden, ordenar } = useOrden();

  const [d, h] = modo === "mes" ? rangoDeMes(mes) : [desde, hasta];
  const rangoValido = Boolean(d && h && d <= h);
  const query = `desde=${d}&hasta=${h}&dias_objetivo=${diasObjetivo}`;

  useEffect(() => {
    if (!rangoValido) return;
    let cancelado = false; // evita "pisar" la respuesta si cambian el filtro rápido
    (async () => {
      setCargando(true);
      setError("");
      try {
        const r = await apiGet(`/inventario/existencias/?${query}`);
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
  }, [query, rangoValido]);

  async function descargarPdf() {
    setPdfCargando(true);
    try {
      const blob = await apiGetBlob(`/inventario/existencias/pdf/?${query}`);
      // Se abre en otra pestaña: desde ahí se puede imprimir o descargar.
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setPdfCargando(false);
    }
  }

  const texto = busqueda.trim().toLowerCase();
  const filas = (datos?.productos || []).filter((f) => {
    if (soloAlertas && !f.alerta && !f.sugerido_comprar) return false;
    if (!texto) return true;
    return [f.producto, f.categoria].some((c) => c.toLowerCase().includes(texto));
  });
  // El backend ya ordena por lo más vendido; el th permite reordenar.
  const ordenadas = ordenar(filas, (f, campo) => f[campo]);
  const visibles = ordenadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const tot = datos?.totales;
  const hayNegativos = (datos?.productos || []).some((f) => f.existencia < 0);

  function exportarExcel() {
    // Mismas columnas y mismo orden que la pantalla, con el nombre largo:
    // en el Excel no hay tooltip que explique un encabezado abreviado.
    const filasExcel = filas.map((f) => ({
      Producto: f.producto,
      Categoría: f.categoria,
      "Existencia hoy": f.existencia,
      "Había antes del período": f.existencia_inicial,
      "Entró (compras)": f.compras,
      "Se vendió": f.ventas,
      "Ajustes (+ entró / - salió)": f.ajustes,
      "Venta promedio por día": f.promedio_diario,
      "Rotación (veces en el período)": f.rotacion,
      "Alcanza para (días)": f.dias_cobertura,
      [`Comprar para cubrir ${datos.dias_objetivo} días`]: f.sugerido_comprar,
    }));
    const hoja = XLSX.utils.json_to_sheet(filasExcel);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Existencias");
    XLSX.writeFile(libro, `Existencias_${d}_${h}.xlsx`);
  }

  return (
    <div>
      <div className="page-top page-top-acciones">
        <div className="page-actions">
          <button
            className="btn-secondary btn-wide"
            onClick={exportarExcel}
            disabled={filas.length === 0}
          >
            <FontAwesomeIcon icon={faFileExcel} /> Exportar a Excel
          </button>
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

      {/* ===== Filtros de período ===== */}
      <div className="inf-filtros">
        <div className="inf-modo">
          <button className={modo === "mes" ? "activo" : ""} onClick={() => setModo("mes")}>
            Por mes
          </button>
          <button className={modo === "rango" ? "activo" : ""} onClick={() => setModo("rango")}>
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

        <label className="inf-fecha-label" title="Para cuántos días debe alcanzar la compra sugerida">
          Cubrir
          <select
            className="inf-input"
            value={diasObjetivo}
            onChange={(e) => setDiasObjetivo(Number(e.target.value))}
          >
            <option value={7}>7 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
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
            <FontAwesomeIcon icon={faSpinner} spin /> Calculando existencias...
          </div>
        </div>
      )}

      {rangoValido && !cargando && datos && (
        <>
          {/* ===== Tarjetas de resumen ===== */}
          <div className="inv-tarjetas">
            <TarjetaInv
              etiqueta="Existencia total"
              valor={num(tot.existencia)}
              sub={`${tot.productos} productos con control`}
              color="#132F63"
            />
            <TarjetaInv
              etiqueta="Unidades vendidas"
              valor={num(tot.ventas)}
              sub={`en ${datos.dias} días`}
              color="#1FA35C"
            />
            <TarjetaInv
              etiqueta="Sin existencia"
              valor={num(tot.sin_existencia)}
              sub="productos agotados"
              color="#D62828"
            />
            <TarjetaInv
              etiqueta="Por reponer"
              valor={num(tot.por_reponer)}
              sub={`para cubrir ${datos.dias_objetivo} días`}
              color="#7B3FA9"
            />
          </div>

          {/* Caso clásico al estrenar el módulo: se marca un producto que ya
              tenía ventas registradas, y como todavía no se cargó lo que hay
              en bodega, la existencia queda negativa. Conviene decirlo, no
              dejar que el usuario interprete un número raro. */}
          {hayNegativos && (
            <div className="aviso-carrito alerta">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>
                Hay productos con <b>existencia negativa</b>: sus ventas ya
                restan pero todavía no se cargó lo que hay en bodega. Andá a la
                pestaña <b>Ajustes</b> y registrá un <b>Inventario inicial</b>{" "}
                con las unidades que tenés hoy.
              </span>
            </div>
          )}

          {tot.productos === 0 ? (
            <div className="table-card">
              <div className="table-empty">
                Ningún producto tiene el control de inventario activado. Andá a{" "}
                <b>Productos</b>, editá el producto y marcá "Controla inventario"
                para que aparezca acá.
              </div>
            </div>
          ) : (
            <>
              <div className="inv-barra-filtros">
                <div className="search-bar">
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="search-bar-icon" />
                  <input
                    type="text"
                    placeholder="Buscar por producto o categoría..."
                    value={busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value);
                      setPagina(1);
                    }}
                  />
                </div>
                <label className="form-check form-check-inline">
                  <input
                    type="checkbox"
                    checked={soloAlertas}
                    onChange={(e) => {
                      setSoloAlertas(e.target.checked);
                      setPagina(1);
                    }}
                  />
                  <span>Solo lo que hay que reponer</span>
                </label>
              </div>

              <div className="table-card">
                {filas.length === 0 ? (
                  <div className="table-empty">
                    Ningún producto coincide con el filtro.
                  </div>
                ) : (
                  <table className="data-table tabla-inv">
                    <thead>
                      {/* La existencia va de primera después del nombre: es
                          el número que todo el mundo busca al abrir el
                          reporte. Las cuatro columnas que siguen explican
                          CÓMO se llegó a esa existencia, y las últimas tres
                          qué hacer con ella. */}
                      <tr>
                        <ThOrden campo="producto" orden={orden} onClick={cambiarOrden}>Producto</ThOrden>
                        <ThOrden campo="categoria" orden={orden} onClick={cambiarOrden}>Categoría</ThOrden>
                        <ThOrden
                          campo="existencia" orden={orden} onClick={cambiarOrden}
                          ayuda="Lo que queda hoy en bodega"
                        >
                          Existencia hoy
                        </ThOrden>
                        <ThOrden
                          campo="existencia_inicial" orden={orden} onClick={cambiarOrden}
                          ayuda="Lo que había el día antes de que empezara el período"
                        >
                          Había antes
                        </ThOrden>
                        <ThOrden
                          campo="compras" orden={orden} onClick={cambiarOrden}
                          ayuda="Unidades compradas al proveedor en el período (los movimientos de Gasto)"
                        >
                          Entró
                        </ThOrden>
                        <ThOrden
                          campo="ventas" orden={orden} onClick={cambiarOrden}
                          ayuda="Unidades vendidas en el período"
                        >
                          Se vendió
                        </ThOrden>
                        <ThOrden
                          campo="ajustes" orden={orden} onClick={cambiarOrden}
                          ayuda="Lo que entró o salió sin pasar por caja: inventario inicial, mermas y conteos"
                        >
                          Ajustes
                        </ThOrden>
                        <ThOrden
                          campo="promedio_diario" orden={orden} onClick={cambiarOrden}
                          ayuda="Unidades que se venden por día, en promedio, durante el período"
                        >
                          Venta/día
                        </ThOrden>
                        <ThOrden
                          campo="rotacion" orden={orden} onClick={cambiarOrden}
                          ayuda="Cuántas veces se vendió el inventario completo en el período. Alta = se mueve rápido; baja = plata detenida en bodega"
                        >
                          Rotación
                        </ThOrden>
                        <ThOrden
                          campo="dias_cobertura" orden={orden} onClick={cambiarOrden}
                          ayuda="Para cuántos días alcanza lo que queda, al ritmo de venta del período. Es también cada cuánto hay que reponer"
                        >
                          Alcanza para
                        </ThOrden>
                        <ThOrden
                          campo="sugerido_comprar" orden={orden} onClick={cambiarOrden}
                          ayuda={"Unidades a comprar para cubrir los próximos " + datos.dias_objetivo + " días"}
                        >
                          Comprar ({datos.dias_objetivo} d)
                        </ThOrden>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((f) => (
                        <tr key={f.producto_id} className={f.alerta ? "fila-alerta" : ""}>
                          <td>{f.producto}</td>
                          <td className="celda-apagada">{f.categoria}</td>
                          <td className={"num inv-existencia" + (f.alerta ? " inv-agotado" : "")}>
                            {f.existencia}
                          </td>
                          {/* El "cómo se llegó" va en gris: es el detalle que
                              respalda la existencia, no lo que hay que leer. */}
                          <td className="num celda-apagada">{f.existencia_inicial}</td>
                          <td className="num celda-apagada">{f.compras || "-"}</td>
                          <td className="num celda-apagada">{f.ventas || "-"}</td>
                          <td className="num celda-apagada">
                            {f.ajustes === 0 ? "-" : f.ajustes > 0 ? "+" + f.ajustes : f.ajustes}
                          </td>
                          <td className="num">{num(f.promedio_diario)}</td>
                          <td className="num">
                            {f.rotacion === null ? "-" : num(f.rotacion) + "x"}
                          </td>
                          {/* "ya" y no "0 d": el cero acá significa que no
                              alcanza ni para hoy, no que no aplique. */}
                          <td className="num">
                            {f.dias_cobertura === null
                              ? "-"
                              : f.dias_cobertura < 1
                                ? "ya"
                                : Math.round(f.dias_cobertura) + " d"}
                          </td>
                          <td className={"num" + (f.sugerido_comprar ? " inv-sugerido" : "")}>
                            {f.sugerido_comprar || "-"}
                          </td>
                        </tr>
                      ))}
                      {/* Un total por columna, en su columna: mezclar
                          compras con ajustes acá hacía que la fila no
                          cuadrara con su propia cabecera. */}
                      <tr className="resumen-prod-total">
                        <td colSpan={2}>TOTALES</td>
                        <td className="num">{tot.existencia}</td>
                        <td className="num">{tot.existencia_inicial}</td>
                        <td className="num">{tot.compras || "-"}</td>
                        <td className="num">{tot.ventas}</td>
                        <td className="num">
                          {tot.ajustes === 0 ? "-" : tot.ajustes > 0 ? "+" + tot.ajustes : tot.ajustes}
                        </td>
                        {/* Promedios y sugerencias NO se suman: un total de
                            "rotación" o de "días de cobertura" no significa
                            nada. Por eso estas columnas van vacías. */}
                        <td className="num" colSpan={4}></td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>

              <Paginacion
                total={filas.length}
                pagina={pagina}
                porPagina={POR_PAGINA}
                onCambio={setPagina}
              />

              {/* Cómo leer el reporte: las mismas definiciones que salen
                  impresas en el PDF, para que nadie tenga que adivinar. */}
              <div className="inv-leyenda">
                <h3>
                  <FontAwesomeIcon icon={faCircleInfo} /> Cómo leer este reporte
                </h3>
                <ul>
                  <li>
                    <b>Existencia hoy</b> es la cuenta de las cuatro columnas
                    grises que le siguen: <b>había antes</b> + <b>entró</b> -{" "}
                    <b>se vendió</b> + <b>ajustes</b>. Lo que "entró" son las
                    compras al proveedor, o sea los movimientos de{" "}
                    <b>Gasto</b> de ese producto.
                  </li>
                  <li>
                    <b>Venta/día</b> es el ritmo: unidades vendidas entre los
                    días del período. De ahí salen las dos últimas columnas.
                  </li>
                  <li>
                    <b>Rotación</b>: cuántas veces se vendió el inventario
                    completo en el período. Arriba de 1x el producto se mueve;
                    abajo de 0.5x es plata detenida en bodega.
                  </li>
                  <li>
                    <b>Alcanza para</b>: a ese ritmo, cuántos días dura lo que
                    queda. Es también cada cuánto hay que reponer.
                  </li>
                  <li>
                    <b>Comprar</b>: unidades a pedir para no quedarse corto en
                    los próximos {datos.dias_objetivo} días (lo cambiás con el
                    selector "Cubrir" de arriba). Las filas en rojo son las que
                    alcanzan para menos de una semana.
                  </li>
                </ul>
                <span className="inv-leyenda-pie">
                  Período {fechaCorta(datos.desde)} - {fechaCorta(datos.hasta)} ·{" "}
                  {datos.dias} días
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TarjetaInv({ etiqueta, valor, sub, color }) {
  return (
    <div className="inf-card">
      <span className="inf-card-icon" style={{ background: color }}>
        <FontAwesomeIcon icon={faWarehouse} />
      </span>
      <div className="inf-card-textos">
        <span className="inf-card-label">{etiqueta}</span>
        <span className="inf-card-valor" style={{ color }}>
          {valor}
        </span>
        <span className="inf-card-sub">{sub}</span>
      </div>
    </div>
  );
}

// ======================================================================
// AJUSTES DE INVENTARIO
// ======================================================================
function Ajustes() {
  const [items, setItems] = useState([]);
  const [productos, setProductos] = useState([]);
  const [stock, setStock] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [ajustes, prods, existencias] = await Promise.all([
        apiGet("/ajustes-inventario/"),
        apiGet("/productos/"),
        apiGet("/inventario/stock/"),
      ]);
      setItems(ajustes);
      // Solo los productos que llevan existencias pueden ajustarse.
      setProductos(prods.filter((p) => p.controla_inventario));
      setStock(
        existencias.reduce((acc, e) => {
          acc[e.producto] = e.existencia;
          return acc;
        }, {})
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function eliminar(id) {
    if (!(await confirmarEliminar("este ajuste"))) return;
    try {
      await apiDelete(`/ajustes-inventario/${id}/`);
      avisoExito("Ajuste eliminado");
      cargar();
    } catch (e) {
      mostrarError(e.message);
    }
  }

  const visibles = items.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <div>
      <div className="page-top page-top-acciones">
        <div className="page-actions">
          <button
            className="btn-primary"
            onClick={() => setModal(true)}
            disabled={productos.length === 0}
          >
            <FontAwesomeIcon icon={faPlus} /> Registrar ajuste
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="aviso-carrito neutro">
        <FontAwesomeIcon icon={faCircleInfo} />
        <span>
          Acá van las entradas y salidas que <b>no pasan por caja</b>: el
          inventario inicial, las mermas y las diferencias de un conteo físico.
          Las <b>compras</b> se registran como movimientos de <b>Gasto</b> en
          Movimientos Diarios, y las ventas ya restan solas.
        </span>
      </div>

      {!cargando && productos.length === 0 && (
        <div className="table-card">
          <div className="table-empty">
            Ningún producto tiene el control de inventario activado. Marcá
            "Controla inventario" en la ficha del producto para poder ajustarlo.
          </div>
        </div>
      )}

      {productos.length > 0 && (
        <div className="table-card">
          {cargando ? (
            <div className="table-empty">
              <FontAwesomeIcon icon={faSpinner} spin /> Cargando...
            </div>
          ) : items.length === 0 ? (
            <div className="table-empty">
              Todavía no hay ajustes registrados. Si ya tenés mercadería en
              bodega, cargala con un ajuste de tipo "Inventario inicial".
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th className="num">Cantidad</th>
                  <th>Motivo</th>
                  <th>Registró</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((a) => (
                  <tr key={a.id}>
                    <td>{fechaCorta(a.fecha)}</td>
                    <td>{a.producto_nombre}</td>
                    <td>
                      <span className={a.tipo === "Salida" ? "badge-gasto" : "badge-venta"}>
                        {a.tipo}
                      </span>
                    </td>
                    <td className={"num" + (a.efecto < 0 ? " monto-gasto" : "")}>
                      {a.efecto > 0 ? `+${a.efecto}` : a.efecto}
                    </td>
                    <td className="celda-apagada">{a.motivo}</td>
                    <td className="celda-apagada">{a.registrado_por_nombre || "-"}</td>
                    <td>
                      <button
                        className="btn-icon-danger"
                        onClick={() => eliminar(a.id)}
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
      )}

      <Paginacion
        total={items.length}
        pagina={pagina}
        porPagina={POR_PAGINA}
        onCambio={setPagina}
      />

      {modal && (
        <AjusteForm
          productos={productos}
          stock={stock}
          onClose={() => setModal(false)}
          onGuardado={() => {
            setModal(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// ===== Modal de ajuste =====
// Trae el "ajustar a" para el caso más común: el conteo físico. El usuario
// escribe cuántas unidades contó y el formulario deduce el tipo y la
// diferencia, en vez de hacerle la resta a mano.
function AjusteForm({ productos, stock, onClose, onGuardado }) {
  const [producto, setProducto] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [tipo, setTipo] = useState("Entrada");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [contado, setContado] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const opciones = productos.map((p) => ({
    id: p.id,
    label: `${p.nombre} - existencia: ${stock[p.id] ?? 0}`,
  }));
  const existencia = producto ? stock[producto] ?? 0 : null;
  const ayuda = TIPOS_AJUSTE.find((t) => t.valor === tipo)?.ayuda;

  // Conteo físico: "tengo 37 contadas" -> entrada/salida de la diferencia.
  function aplicarConteo() {
    const contadas = Number(contado);
    if (contado === "" || Number.isNaN(contadas)) return;
    const diferencia = contadas - (existencia ?? 0);
    if (diferencia === 0) {
      setError("El conteo coincide con la existencia: no hace falta ajustar.");
      return;
    }
    setError("");
    setTipo(diferencia > 0 ? "Entrada" : "Salida");
    setCantidad(String(Math.abs(diferencia)));
    setMotivo(
      `Conteo físico: contadas ${contadas}, el sistema tenía ${existencia ?? 0}.`
    );
  }

  async function guardar(e) {
    e.preventDefault();
    if (!producto) {
      setError("Elegí el producto.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await apiPost("/ajustes-inventario/", {
        producto,
        fecha,
        tipo,
        cantidad: Number(cantidad),
        motivo: motivo.trim(),
      });
      avisoExito("Ajuste registrado");
      onGuardado();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  const resultado =
    existencia === null || cantidad === ""
      ? null
      : existencia + (tipo === "Salida" ? -Number(cantidad) : Number(cantidad));

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Nuevo ajuste de inventario</h2>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={guardar}>
          <label className="form-label">Producto</label>
          <SearchableSelect
            opciones={opciones}
            valor={producto}
            onChange={setProducto}
            placeholder="Escribí el producto para buscar..."
          />

          {producto && (
            <div className="aviso-carrito neutro">
              <FontAwesomeIcon icon={faSliders} />
              <span>
                El sistema tiene <b>{existencia}</b> unidades. ¿Contaste otra
                cantidad? Escribila y se calcula la diferencia.
              </span>
            </div>
          )}

          {producto && (
            <>
              <label className="form-label">Ajustar a la cantidad contada (opcional)</label>
              <div className="cedula-row">
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={contado}
                  onChange={(e) => setContado(e.target.value)}
                  placeholder="Ej: 37"
                />
                <button type="button" className="btn-secondary" onClick={aplicarConteo}>
                  Calcular
                </button>
              </div>
            </>
          )}

          <div className="form-fila-2">
            <div>
              <label className="form-label">Fecha</label>
              <input
                className="form-input"
                type="date"
                value={fecha}
                onChange={(e) => e.target.value && setFecha(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label">Cantidad</label>
              <input
                className="form-input"
                type="number"
                min="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                required
              />
            </div>
          </div>

          <label className="form-label">Tipo de ajuste</label>
          <select
            className="form-input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {TIPOS_AJUSTE.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="form-hint">{ayuda}</p>

          <label className="form-label">Motivo</label>
          <input
            className="form-input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: 3 cajas rotas en bodega"
            required
          />

          {resultado !== null && (
            <div className={"totales-vivo" + (resultado < 0 ? " es-gasto" : "")}>
              <span>
                Existencia actual: <b>{existencia}</b>
              </span>
              <span>
                Queda en: <b>{resultado}</b>
              </span>
            </div>
          )}

          {resultado !== null && resultado < 0 && (
            <div className="aviso-carrito alerta">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>
                La existencia quedaría en negativo. Revisá si falta registrar una
                compra o el inventario inicial.
              </span>
            </div>
          )}

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
