"""
Views for customisation file upload pre-signing and local storage emulation endpoints.
"""

import hmac
import hashlib
import os
import time
import uuid
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse, HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from schools.models import Student

from .consent_views import CONSENT_REQUIRED, NOT_YOUR_CHILD, caller_may_upload, live_consent
from .models import PhotoConsent
from .storage import (
    generate_presigned_download,
    generate_presigned_upload,
    get_storage_mode,
)


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class PresignedUploadUrlView(APIView):
    """
    POST /api/orders/customisation-upload-url/
    Body:
    {
        "content_type": "image/jpeg",
        "file_size": 482000,
        "filename": "my_photo.jpg"
    }

    Returns:
    {
        "upload_url": "...",
        "method": "POST" | "PUT",
        "fields": {...},
        "file_key": "customisations/2026/10/uuid.jpg",
        "expires_in": 300
    }

    The frontend uploads direct to the object storage endpoint.
    Django workers and bandwidth are completely bypassed.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        content_type = (request.data.get("content_type") or "").strip().lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise ValidationError(
                {"content_type": f"Unsupported type '{content_type}'. Must be JPEG, PNG, or WEBP."}
            )

        file_size = request.data.get("file_size")
        max_bytes = getattr(settings, "CUSTOMISATION_MAX_IMAGE_BYTES", 1_500_000)
        if file_size and int(file_size) > max_bytes:
            raise ValidationError(
                {"file_size": f"File size ({file_size} bytes) exceeds {max_bytes} bytes (~1.5 MB) limit."}
            )

        purpose = (request.data.get("purpose") or "").strip()
        if purpose not in PhotoConsent.Purpose.values:
            raise ValidationError({"purpose": "Choose NOTEBOOK or ID_CARD."})
        student_id = request.data.get("student_id")
        try:
            student = Student.objects.get(pk=student_id)
        except (Student.DoesNotExist, ValueError, TypeError, DjangoValidationError):
            raise PermissionDenied(NOT_YOUR_CHILD)
        if not caller_may_upload(request.user, student):
            raise PermissionDenied(NOT_YOUR_CHILD)
        if live_consent(student, purpose) is None:
            raise PermissionDenied(CONSENT_REQUIRED)

        # Generate a secure, unique object storage key
        user_id = str(request.user.id)
        token = uuid.uuid4().hex
        ext = "jpg" if "jpeg" in content_type else "png" if "png" in content_type else "webp"
        timestamp = time.strftime("%Y/%m/%d")
        file_key = f"customisations/{timestamp}/{user_id[:8]}_{token}.{ext}"

        upload_payload = generate_presigned_upload(
            file_key=file_key,
            content_type=content_type,
            max_bytes=max_bytes,
            expires_in=300,
        )
        return Response(upload_payload)


@csrf_exempt
def local_storage_upload_view(request):
    """
    Direct upload receiver for local environment / unit tests when not connected to real S3.
    Directly streams request body to disk, validating HMAC signature and expiry.
    """
    if request.method not in ("PUT", "POST"):
        return HttpResponseBadRequest("Method not allowed")

    key = request.GET.get("key")
    expires = request.GET.get("expires")
    sig = request.GET.get("signature")
    content_type = request.GET.get("content_type") or "image/jpeg"

    if not key or not expires or not sig:
        return HttpResponseBadRequest("Missing signature parameters")

    try:
        exp_int = int(expires)
        if time.time() > exp_int:
            return HttpResponseForbidden("Upload URL expired")
    except ValueError:
        return HttpResponseBadRequest("Invalid expires parameter")

    # Verify HMAC
    secret = settings.SECRET_KEY.encode("utf-8")
    payload = f"{key}:{expires}:{content_type}".encode("utf-8")
    expected_sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        return HttpResponseForbidden("Invalid upload signature")

    # Save directly to disk
    storage_dir = getattr(settings, "CUSTOMISATION_LOCAL_DIR", settings.MEDIA_ROOT / "customisations")
    path = os.path.join(storage_dir, key.replace("/", os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "wb") as f:
        f.write(request.body)

    return HttpResponse(status=200)


def local_storage_download_view(request):
    """
    Signed download view for local environment when not connected to real S3.
    Validates HMAC signature and expiry, then streams file response.
    """
    key = request.GET.get("key")
    expires = request.GET.get("expires")
    sig = request.GET.get("signature")

    if not key or not expires or not sig:
        return HttpResponseBadRequest("Missing signature parameters")

    try:
        exp_int = int(expires)
        if time.time() > exp_int:
            return HttpResponseForbidden("Download URL expired")
    except ValueError:
        return HttpResponseBadRequest("Invalid expires parameter")

    # Verify HMAC
    secret = settings.SECRET_KEY.encode("utf-8")
    payload = f"get:{key}:{expires}".encode("utf-8")
    expected_sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        return HttpResponseForbidden("Invalid download signature")

    storage_dir = getattr(settings, "CUSTOMISATION_LOCAL_DIR", settings.MEDIA_ROOT / "customisations")
    path = os.path.join(storage_dir, key.replace("/", os.sep))
    if not os.path.exists(path):
        return HttpResponse(status=404)

    return FileResponse(open(path, "rb"), content_type="image/jpeg")
