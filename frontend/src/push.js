// Notificaciones push nativas (Web Push): suscribe el dispositivo actual
// para que reciba avisos del sistema operativo aunque la página esté
// cerrada. Requiere HTTPS (o localhost) y que el navegador soporte
// Notification + PushManager (no todos: Firefox de escritorio sí, algunos
// navegadores embebidos no).
import { apiGet, apiPost, apiDelete } from "./api";

export function pushDisponible() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function permisoConcedido() {
  return pushDisponible() && Notification.permission === "granted";
}

export function permisoDenegado() {
  return pushDisponible() && Notification.permission === "denied";
}

// El navegador exige la clave VAPID en bytes crudos, no en el texto base64
// que manda el backend.
function base64UrlABytes(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(base64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

export async function estaSuscrito() {
  if (!pushDisponible()) return false;
  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.getSubscription();
  return Boolean(suscripcion);
}

// Pide permiso (si hace falta) y suscribe este dispositivo en el backend.
export async function activarPush() {
  if (!pushDisponible()) throw new Error("Este navegador no soporta notificaciones push.");

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    throw new Error("No se concedió el permiso de notificaciones.");
  }

  const registro = await navigator.serviceWorker.ready;
  let suscripcion = await registro.pushManager.getSubscription();
  if (!suscripcion) {
    const { public_key: clavePublica } = await apiGet("/push/clave-publica/");
    suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlABytes(clavePublica),
    });
  }

  const json = suscripcion.toJSON();
  await apiPost("/push/suscripcion/", {
    endpoint: json.endpoint,
    keys: json.keys,
  });
  return suscripcion;
}

// Desactiva las notificaciones EN ESTE dispositivo (no afecta otros
// celulares/navegadores donde el mismo usuario también se haya suscrito).
export async function desactivarPush() {
  if (!pushDisponible()) return;
  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.getSubscription();
  if (!suscripcion) return;
  const endpoint = suscripcion.endpoint;
  await suscripcion.unsubscribe();
  await apiDelete("/push/suscripcion/", { endpoint }).catch(() => {});
}
