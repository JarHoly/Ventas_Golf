import { useIdioma } from "./i18n";
import "./SelectorIdioma.css";

// variant="overlay" para fondos con foto (Login); "navbar" para el navbar blanco.
export default function SelectorIdioma({ variant = "navbar" }) {
  const { idioma, setIdioma } = useIdioma();

  return (
    <div className={`selector-idioma selector-idioma-${variant}`}>
      <button
        className={idioma === "es" ? "activo" : ""}
        onClick={() => setIdioma("es")}
        title="Español"
      >
        ES
      </button>
      <button
        className={idioma === "en" ? "activo" : ""}
        onClick={() => setIdioma("en")}
        title="English"
      >
        EN
      </button>
    </div>
  );
}
