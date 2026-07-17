API_URL = process.env.API_URL || "https://staging.golf.corvana.net/api";

// Manda usuario + clave al backend. Si son correctos devuelve {token, username, nombre}.
// Si no, lanza un error con el mensaje que vino del servidor.
export async function login(username, password) {
  const res = await fetch(`${API_URL}/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "No se pudo iniciar sesión.");
  }
  return data;
}
