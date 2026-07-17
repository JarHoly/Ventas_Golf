import { useState } from "react";
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
    backgroundImage: `url(${process.env.PUBLIC_URL}/golf-bg.jpg), linear-gradient(#cdd8e6, #eef2f7)`,
  };

  return (
    <div className="login-page" style={bgStyle}>
      <div className="login-overlay" />

      <div className="login-content">
        {/* Marca */}
        <div className="brand">
          <div className="brand-icon">⛳</div>
          <h1 className="brand-name">Ecuestas</h1>
          <p className="brand-sub">Management Suite v2.4</p>
        </div>

        {/* Tarjeta */}
        <form className="login-card" onSubmit={handleSubmit}>
          <h2 className="card-title">Welcome Back</h2>
          <p className="card-sub">Access your golf sales dashboard</p>

          {error && <div className="login-error">{error}</div>}

          <label className="field-label">Email / Username</label>
          <input
            className="field-input"
            type="text"
            placeholder="john.doe@ecuestas.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />

          <div className="field-label-row">
            <label className="field-label">Password</label>
            <a href="#forgot" className="link">
              Forgot Password?
            </a>
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
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Keep me logged in
          </label>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Log In →"}
          </button>

          <div className="card-divider" />
          <p className="card-footer-text">
            Don't have an account?{" "}
            <a href="#contact" className="link">
              Contact Administrator
            </a>
          </p>
        </form>

        {/* Pie de página */}
        <div className="page-footer">
          <div className="footer-links">
            <a href="#privacy" className="link-muted">
              Privacy Policy
            </a>
            <a href="#terms" className="link-muted">
              Terms of Service
            </a>
            <a href="#status" className="link-muted">
              System Status
            </a>
          </div>
          <p className="copyright">
            © 2026 Ecuestas Golf Solutions. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
