"""
Retail shops that sell school uniforms through the store.

A retailer adds a school by sending a SchoolRequest (name, UDISE code,
address, logo). The Boss checks the UDISE code and approves or rejects it.
Approval creates the school, or links the shop to it when a school with that
UDISE code is already on the store. A shop sells only for its approved schools.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from common.models import UUIDModel
from schools.models import Board

from .validators import validate_logo, validate_pincode, validate_udise_code


class RetailStore(UUIDModel):
    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="retail_store",
    )
    name = models.CharField(max_length=200)
    address = models.TextField()
    phone = models.CharField(max_length=20)
    gst_number = models.CharField(max_length=15, blank=True, default="")
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.PROTECT,
        related_name="retail_stores",
    )
    schools = models.ManyToManyField(
        "schools.School",
        blank=True,
        related_name="retail_stores",
        help_text="Schools this shop may sell for: added when the Boss approves a request.",
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class SchoolRequest(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    store = models.ForeignKey(
        RetailStore,
        on_delete=models.CASCADE,
        related_name="school_requests",
    )
    name = models.CharField(max_length=200)
    udise_code = models.CharField(max_length=11, validators=[validate_udise_code], db_index=True)
    address = models.TextField()
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.PROTECT,
        related_name="school_requests",
    )
    board = models.CharField(max_length=10, choices=Board.choices)
    pincode = models.CharField(max_length=6, validators=[validate_pincode])
    logo = models.ImageField(upload_to="school-logos/requests/%Y/%m/", validators=[validate_logo])
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="retail_requests",
        help_text="The school created or linked on approval.",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_school_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "udise_code"],
                condition=Q(status="PENDING"),
                name="uniq_pending_request_per_store_udise",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="idx_schoolreq_status_created"),
        ]

    def __str__(self) -> str:
        return f"{self.name} [{self.udise_code}] ({self.status})"
