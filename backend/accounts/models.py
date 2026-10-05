import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        BOSS = "BOSS", "Boss"
        ADMIN = "ADMIN", "Admin"
        SCHOOL_ADMIN = "SCHOOL_ADMIN", "School Admin"
        TEACHER = "TEACHER", "Teacher"
        PARENT = "PARENT", "Parent"

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
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    must_change_password = models.BooleanField(
        default=False,
        help_text="Set for staff accounts created by another staff member; cleared after first-login password change.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["role", "city"], name="idx_user_role_city"),
            models.Index(fields=["role", "school"], name="idx_user_role_school"),
        ]

    def __str__(self) -> str:
        return f"{self.username} ({self.role})"
