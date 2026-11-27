import base64
import hashlib
import os
import uuid
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


def _password_keystream(nonce: bytes, length: int) -> bytes:
    """Derive a deterministic keystream from SECRET_KEY and a per-record nonce."""
    secret = settings.SECRET_KEY.encode("utf-8")
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hashlib.sha256(secret + nonce + counter.to_bytes(4, "big")).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


class User(AbstractUser):
    class Role(models.TextChoices):
        BOSS = "BOSS", "Boss"
        ADMIN = "ADMIN", "Admin"
        SCHOOL_ADMIN = "SCHOOL_ADMIN", "School Admin"
        TEACHER = "TEACHER", "Teacher"
        PARENT = "PARENT", "Parent"
        RETAILER = "RETAILER", "Retailer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.PARENT,
        db_index=True,
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    branch = models.ForeignKey(
        "schools.SchoolBranch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    phone_verified = models.BooleanField(
        default=False,
        help_text="True once the phone number has been confirmed by OTP. Only verified "
        "numbers are used to link a parent to children on the school roster.",
    )
    must_change_password = models.BooleanField(
        default=False,
        help_text="Set for staff accounts created by another staff member; cleared after first-login password change.",
    )
    all_schools_access = models.BooleanField(
        default=False,
        help_text="When True for a TEACHER, allows accessing all schools, branches, and classes.",
    )
    issued_password_token = models.TextField(
        blank=True,
        default="",
        help_text="Encrypted copy of the generated 6-digit password so admins can view and share it.",
    )
    notify_order_updates = models.BooleanField(
        default=True,
        help_text="True if the user has enabled push notifications for order updates.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_issued_password(self, raw_password: str) -> None:
        """Hash password for Django auth and store an encrypted copy for admin sharing."""
        self.set_password(raw_password)
        raw = raw_password.encode("utf-8")
        nonce = os.urandom(16)
        stream = _password_keystream(nonce, len(raw))
        cipher = bytes(a ^ b for a, b in zip(raw, stream))
        self.issued_password_token = base64.urlsafe_b64encode(nonce + cipher).decode("ascii")

    def get_issued_password(self) -> str:
        """Decrypt the stored 6-digit password for authorized admin display."""
        if not self.issued_password_token:
            return ""
        try:
            blob = base64.urlsafe_b64decode(self.issued_password_token.encode("ascii"))
            if len(blob) < 17:
                return ""
            nonce, cipher = blob[:16], blob[16:]
            stream = _password_keystream(nonce, len(cipher))
            return bytes(a ^ b for a, b in zip(cipher, stream)).decode("utf-8")
        except Exception:
            return ""

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["role", "city"], name="idx_user_role_city"),
            models.Index(fields=["role", "school"], name="idx_user_role_school"),
            models.Index(fields=["role", "branch"], name="idx_user_role_branch"),
        ]

    def __str__(self) -> str:
        return f"{self.username} ({self.role})"
