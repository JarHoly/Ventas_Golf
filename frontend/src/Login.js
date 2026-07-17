import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGolfBallTee,
  faEye,
  faEyeSlash,
  faRightToBracket,
} from "@fortawesome/free-solid-svg-icons";
import { login } from "./api";
import "./Login.css";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); // evita que el formulario recargue la página
    setError("");
    setLoading(true);
    try {
      const data = await login(username, password);
      // Guardamos el token. Si marcó "keep me logged in" queda aunque cierre el navegador
      // (localStorage); si no, solo dura la sesión actual (sessionStorage).
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem("token", data.token);
      storage.setItem("nombre", data.nombre);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // La foto de fondo se lee de frontend/public/golf-bg.jpg.
  // Si el archivo no existe, queda solo el degradado del CSS (no rompe nada).
  const bgStyle = {
    backgroundImage: `url(${process.env.PUBLIC_URL}/golf-bg.png), linear-gradient(#cdd8e6, #eef2f7)`,
  };

  return (
    <div className="login-page" style={bgStyle}>
      <div className="login-overlay" />

      <div className="login-content">
        {/* Tarjeta */}
        <form className="login-card" onSubmit={handleSubmit}>
          {/* Marca */}
          <div className="brand">
            <div className="brand-icon">
              <FontAwesomeIcon icon={faGolfBallTee} />
            </div>
            <h1 className="brand-name">E-Cuestas </h1>
            <p className="brand-sub">Sistema de Ventas v1.0</p>
          </div>
          <h2 className="card-title">¡Bienvenido de vuelta!</h2>
          <p className="card-sub">Accede a tu panel de control de ventas</p>

          {error && <div className="login-error">{error}</div>}

          <label className="field-label">Usuario</label>
          <input
            className="field-input"
            type="text"
            placeholder="John Doe"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />

          <div className="field-label-row">
            <label className="field-label">Contraseña</label>
          </div>
          <div className="password-wrap">
            <input
              className="field-input"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label="Mostrar u ocultar contraseña"
            >
              <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
            </button>
          </div>

          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Recuérdame
          </label>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? (
              "Ingresando..."
            ) : (
              <>
                <FontAwesomeIcon icon={faRightToBracket} /> Iniciar Sesión
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
