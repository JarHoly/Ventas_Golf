"""
Envío de notificaciones push nativas (Web Push / VAPID). Se dispara SIEMPRE
junto con una Notificacion normal (ver _notificar/_notificar_personal en
views.py): la campanita del navbar sigue funcionando igual — esto es un
canal EXTRA que llega al celular como notificación del sistema operativo,
aunque el usuario no tenga la página abierta (requiere haberse suscrito
desde "Instalar la app").
"""
import json
import logging

from django.conf import settings
from pywebpush import WebPushException, webpush

from .models import PushSubscription

logger = logging.getLogger(__name__)


def enviar_push(user, mensaje, url="/"):
    """Manda la notificación a TODOS los dispositivos suscritos de ese
    usuario. Si una suscripción ya no es válida (404/410: el usuario
    desinstaló la app o revocó el permiso), se borra sola — así no se
    acumulan suscripciones muertas. Nunca lanza: un push que falla no debe
    romper el flujo de negocio (crear/aceptar/rechazar una reserva)."""
    payload = json.dumps({"title": "E-Cuestas", "body": mensaje, "url": url})
    for sub in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL},
            )
        except WebPushException as e:
            codigo = getattr(e.response, "status_code", None)
            if codigo in (404, 410):
                sub.delete()
            else:
                logger.warning("Push falló para %s: %s", user.username, e)
        except Exception as e:  # cualquier otro error de red: no debe tumbar la vista
            logger.warning("Push falló para %s: %s", user.username, e)
