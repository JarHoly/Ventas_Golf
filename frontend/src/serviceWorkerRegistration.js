// Registro del service worker para que el sistema se pueda instalar como
// app (PWA). Solo en producción y solo si el navegador lo soporta.
const esLocalhost = Boolean(
  window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]"
);

export function register() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  // El service worker exige HTTPS (localhost es la única excepción, para poder
  // probar el build de producción en la máquina de desarrollo).
  if (window.location.protocol !== "https:" && !esLocalhost) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL}/service-worker.js`)
      .catch(() => {
        // Silencioso: si falla el registro, la app sigue funcionando normal
        // como página web común, solo sin la opción de "instalar".
      });
  });
}

export function unregister() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((registration) => {
    registration.unregister();
  });
}
