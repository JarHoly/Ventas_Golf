// La URL del backend viene de los archivos .env (sin tocar código):
//   npm start      -> lee frontend/.env.development -> http://localhost:8000/api
//   npm run build  -> lee frontend/.env.production  -> https://golf.corvana.net/api
// El valor de respaldo (localhost) solo aplica si faltaran esos archivos.
export const API_URL =
  process.env.REACT_APP_API_URL || "http://localhost:8000/api";

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

// ===== Helpers para llamadas que necesitan estar logueado =====

// Recupera el token guardado (venga de "recuérdame" o de la sesión actual).
function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
}

// Arma los headers con el token. El backend exige "Authorization: Token <token>".
function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Token ${getToken()}`,
  };
}

// Procesa la respuesta: si falló, lanza un error legible; si no, devuelve el JSON.
async function procesar(res) {
  if (res.status === 204) return null; // 204 = borrado exitoso, sin cuerpo
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // DRF manda errores de validación por campo; los juntamos en un texto.
    const msg =
      data.detail ||
      Object.entries(data)
        .map(
          ([campo, errs]) =>
            `${campo}: ${Array.isArray(errs) ? errs.join(", ") : errs}`,
        )
        .join(" · ") ||
      "Ocurrió un error.";
    throw new Error(msg);
  }
  return data;
}

export async function apiGet(path) {
  return procesar(await fetch(`${API_URL}${path}`, { headers: authHeaders() }));
}

export async function apiPost(path, body) {
  return procesar(
    await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }),
  );
}

export async function apiPut(path, body) {
  return procesar(
    await fetch(`${API_URL}${path}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }),
  );
}

export async function apiDelete(path) {
  return procesar(
    await fetch(`${API_URL}${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    }),
  );
}

// Consulta el nombre en el padrón a partir de la cédula.
export async function buscarCedula(cedula) {
  return apiGet(`/cedula/${cedula}/`);
}

// Descarga un archivo (ej. el PDF) mandando el token, y devuelve el blob.
export async function apiGetBlob(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "No se pudo descargar el archivo.");
  }
  return res.blob();
}
