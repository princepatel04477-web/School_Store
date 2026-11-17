from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeviceToken


class DeviceTokenView(APIView):
    """
    Register or unregister an FCM device token for push notifications.
    POST /api/devices/ {"token": "...", "platform": "android"}
    DELETE /api/devices/ {"token": "..."}
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = str(request.data.get("token") or "").strip()
        platform = str(request.data.get("platform") or "android").strip().lower()
        if not token:
            return Response(
                {"token": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if platform not in ("android", "ios", "web"):
            platform = "android"

        device, created = DeviceToken.objects.update_or_create(
            token=token,
            defaults={
                "user": request.user,
                "platform": platform,
                "last_seen_at": timezone.now(),
            },
        )
        return Response(
            {
                "id": str(device.id),
                "token": device.token,
                "platform": device.platform,
                "status": "registered",
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request):
        token = str(
            request.data.get("token") or request.query_params.get("token") or ""
        ).strip()
        if not token:
            return Response(
                {"token": ["Token is required to unregister."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = DeviceToken.objects.filter(token=token, user=request.user).delete()
        return Response(
            {"status": "unregistered", "deleted": deleted > 0},
            status=status.HTTP_200_OK if deleted else status.HTTP_404_NOT_FOUND,
        )


class DeviceTokenDetailView(APIView):
    """
    DELETE /api/devices/<path:token>/
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, token):
        token = str(token or "").strip()
        if not token:
            return Response(
                {"token": ["Token is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = DeviceToken.objects.filter(token=token, user=request.user).delete()
        return Response(
            {"status": "unregistered", "deleted": deleted > 0},
            status=status.HTTP_200_OK if deleted else status.HTTP_404_NOT_FOUND,
        )
