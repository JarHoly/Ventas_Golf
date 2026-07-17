import { useState } from "react";
import Login from "./Login";

function App() {
  // Al abrir la app, revisamos si ya hay un token guardado de antes.
  // Si lo hay, ya estaba logueado; si no, mostramos el login.
  const [token, setToken] = useState(
    () => localStorage.getItem("token") || sessionStorage.getItem("token")
  );
  const [nombre, setNombre] = useState(
    () => localStorage.getItem("nombre") || sessionStorage.getItem("nombre")
  );

  function handleLogin(data) {
    setToken(data.token);
    setNombre(data.nombre);
  }

  function handleLogout() {
    localStorage.clear();
    sessionStorage.clear();
    setToken(null);
    setNombre(null);
  }

  // Si NO hay token -> pantalla de login.
  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  // Si SÍ hay token -> por ahora un saludo simple.
  // Aquí después construirás tu dashboard (clientes, productos, movimientos, reportes).
  return (
    <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1>¡Hola, {nombre}! 👋</h1>
      <p>Entraste correctamente. Aquí irá el sistema de ventas.</p>
      <button
        onClick={handleLogout}
        style={{
          padding: "10px 18px",
          background: "#1b3a6b",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Cerrar sesión
      </button>
    </div>
  );
}

export default App;
