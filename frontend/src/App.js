import { useState } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import { IdiomaProvider } from "./i18n";

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
    // El idioma es una preferencia del dispositivo, no de la sesión:
    // se conserva aunque se cierre sesión.
    const idioma = localStorage.getItem("idioma");
    localStorage.clear();
    sessionStorage.clear();
    if (idioma) localStorage.setItem("idioma", idioma);
    setToken(null);
    setNombre(null);
  }

  return (
    <IdiomaProvider>
      {/* Si NO hay token -> pantalla de login. Si SÍ -> el dashboard. */}
      {!token ? (
        <Login onLogin={handleLogin} />
      ) : (
        <Dashboard nombre={nombre} onLogout={handleLogout} />
      )}
    </IdiomaProvider>
  );
}

export default App;
