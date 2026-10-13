"""Parent consent to use a child's photo, and the request to delete those photos."""

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from schools.models import Student

from .models import PhotoConsent
from .photo_files import delete_student_photos

CONSENT_REQUIRED = "A parent must agree before a photo of this child can be uploaded."
NOT_YOUR_CHILD = "You can upload a photo only for your own child."
PARENTS_ONLY = "Only a parent can agree to a child's photo."


def client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return (request.META.get("REMOTE_ADDR") or "")[:45]


def client_user_agent(request) -> str:
    return (request.META.get("HTTP_USER_AGENT") or "")[:300]


def owned_student(user, student_id) -> Student:
    try:
        student = Student.objects.get(pk=student_id)
    except (Student.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        raise PermissionDenied(NOT_YOUR_CHILD)
    if student.parent_id != user.id:
        raise PermissionDenied(NOT_YOUR_CHILD)
    return student


def caller_may_upload(user, student: Student) -> bool:
    role = getattr(user, "role", "")
    if role == "PARENT":
        return student.parent_id == user.id
    if role == "TEACHER":
        return bool(student.school_id) and student.school_id == user.school_id
    return False


def live_consent(student, purpose: str):
    return PhotoConsent.objects.filter(
        student=student,
        purpose=purpose,
        withdrawn_at__isnull=True,
    ).first()


class PhotoConsentCreateView(APIView):
    """
    POST /api/orders/photo-consent/
    { "student_id", "purpose": "NOTEBOOK"|"ID_CARD", "keep_for_next_year": false }
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if getattr(request.user, "role", "") != "PARENT":
            raise PermissionDenied(PARENTS_ONLY)

        purpose = (request.data.get("purpose") or "").strip()
        if purpose not in PhotoConsent.Purpose.values:
            raise ValidationError({"purpose": "Choose NOTEBOOK or ID_CARD."})

        student = owned_student(request.user, request.data.get("student_id"))
        keep = bool(request.data.get("keep_for_next_year"))
        if purpose != PhotoConsent.Purpose.ID_CARD:
            keep = False

        existing = live_consent(student, purpose)
        if existing and existing.parent_id == request.user.id:
            if keep and not existing.keep_for_next_year:
                existing.keep_for_next_year = True
                existing.save(update_fields=["keep_for_next_year"])
            return Response(_consent_payload(existing), status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                consent = PhotoConsent.objects.create(
                    parent=request.user,
                    student=student,
                    purpose=purpose,
                    policy_version=getattr(settings, "PHOTO_CONSENT_POLICY_VERSION", "2026-10-13"),
                    keep_for_next_year=keep,
                    ip=client_ip(request),
                    user_agent=client_user_agent(request),
                )
        except IntegrityError:
            consent = PhotoConsent.objects.get(
                parent=request.user,
                student=student,
                purpose=purpose,
                withdrawn_at__isnull=True,
            )
            return Response(_consent_payload(consent), status=status.HTTP_200_OK)

        return Response(_consent_payload(consent), status=status.HTTP_201_CREATED)


class PhotoConsentDeleteView(APIView):
    """
    POST /api/orders/photo-consent/delete/
    { "student_id": "..." }
    Deletes every photo file for that child and withdraws live consent.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if getattr(request.user, "role", "") != "PARENT":
            raise PermissionDenied(PARENTS_ONLY)
        student = owned_student(request.user, request.data.get("student_id"))
        removed = delete_student_photos(student.id)
        now = timezone.now()
        PhotoConsent.objects.filter(student=student, withdrawn_at__isnull=True).update(withdrawn_at=now)
        return Response({"detail": "Photos deleted.", "files_removed": removed})


def _consent_payload(consent: PhotoConsent) -> dict:
    return {
        "id": str(consent.id),
        "student_id": str(consent.student_id),
        "purpose": consent.purpose,
        "policy_version": consent.policy_version,
        "keep_for_next_year": consent.keep_for_next_year,
        "created_at": consent.created_at,
    }
