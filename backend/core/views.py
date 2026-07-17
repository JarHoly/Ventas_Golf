from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def login_view(request):
    """
    Recibe {"username": "...", "password": "..."} y, si son correctos,
    devuelve un token que el frontend guardará para las siguientes llamadas.
    """
    username = request.data.get("username")
    password = request.data.get("password")

    # authenticate() compara la clave contra la versión encriptada de la BD.
    # Si algo no coincide, devuelve None
    user = authenticate(username=username, password=password)

    if user is None:
        return Response(
            {"detail": "Usuario o contraseña incorrectos."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    # get_or_create: si ya tenía token se reusa, si no se crea uno.
    token, _ = Token.objects.get_or_create(user=user)
    return Response({
        "token": token.key,
        "username": user.username,
        "nombre": user.get_full_name() or user.username,
    })
