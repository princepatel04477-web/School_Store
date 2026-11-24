from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.shoulder_estimate import get_size_advice_accuracy_report


class SizeAdviceAccuracyView(APIView):
    """
    GET /api/panel/size-accuracy/
    Boss/Admin endpoint returning size advice accuracy metrics and flagged size charts (Prompt 9).
    """

    def get(self, request):
        user = request.user
        if not (
            user
            and user.is_authenticated
            and (
                getattr(user, "role", "") in ("BOSS", "ADMIN")
                or getattr(user, "is_superuser", False)
                or getattr(user, "is_staff", False)
            )
        ):
            raise PermissionDenied("Only Boss and Admin have access to size advice accuracy.")

        report = get_size_advice_accuracy_report()
        return Response(report)
