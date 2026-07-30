// Service worker MÍNIMO: su único trabajo es cumplir el requisito técnico
// para que el navegador ofrezca "instalar como app" (Chrome/Android exige un
// service worker con manejador de fetch, aunque sea de solo paso). No cachea
// nada del negocio: los movimientos/reservas siempre deben venir frescos del
// servidor, así que cada fetch simplemente va a la red.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (evento) => {
  evento.respondWith(fetch(evento.request));
});

// ----- Web Push: notificación nativa del sistema operativo -----
self.addEventListener("push", (evento) => {
  let datos = { title: "E-Cuestas", body: "Tenés una notificación nueva.", url: "/" };
  if (evento.data) {
    try {
      datos = evento.data.json();
    } catch {
      datos.body = evento.data.text();
    }
  }
  evento.waitUntil(
    self.registration.showNotification(datos.title || "E-Cuestas", {
      body: datos.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: datos.url || "/" },
    })
  );
});

// Al tocar la notificación: enfoca una pestaña ya abierta o abre una nueva.
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = evento.notification.data?.url || "/";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ("focus" in cliente) return cliente.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
