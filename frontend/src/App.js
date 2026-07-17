import { useState } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";

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

  // Si SÍ hay token -> el dashboard del sistema.
  return <Dashboard nombre={nombre} onLogout={handleLogout} />;
}

export default App;
