"""Boss decisions on retailers' school requests."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from common.audit import log_audit_event
from common.exceptions import Conflict
from common.models import AuditLog
from schools.models import School

from .models import SchoolRequest


def matching_school(request_obj: SchoolRequest) -> School | None:
    """The school already on the store with this request's UDISE code, if any."""
    return School.objects.filter(udise_code=request_obj.udise_code).first()


def _locked_pending(request_id) -> SchoolRequest:
    request_obj = SchoolRequest.objects.select_for_update().select_related("store").get(pk=request_id)
    if request_obj.status != SchoolRequest.Status.PENDING:
        raise Conflict(f"This request was already {request_obj.get_status_display().lower()}.")
    return request_obj


@transaction.atomic
def approve_request(request_id, reviewer, *, link_school: School | None = None, use_new_logo: bool = True, http_request=None) -> SchoolRequest:
    """
    Approve a pending request and give the shop that school.

    The school is the one with the same UDISE code, else `link_school` (an
    older school added before UDISE codes were asked, which then gets this
    code), else a new school made from the request. A new school starts
    hidden from parents: it goes live once it has uniforms to sell.
    `use_new_logo` puts the request's logo on a school that already has one.
    """
    request_obj = _locked_pending(request_id)
    school = School.objects.select_for_update().filter(udise_code=request_obj.udise_code).first()
    if school and link_school and link_school.pk != school.pk:
        raise ValidationError({"school": f"UDISE code {request_obj.udise_code} already belongs to {school.name}."})

    if school is None and link_school is not None:
        school = School.objects.select_for_update().get(pk=link_school.pk)
        if school.udise_code:
            raise ValidationError({"school": f"{school.name} already has UDISE code {school.udise_code}."})
        school.udise_code = request_obj.udise_code
        for field in ("board", "pincode"):
            if not getattr(school, field):
                setattr(school, field, getattr(request_obj, field))
        if not school.logo or use_new_logo:
            school.logo = request_obj.logo.name
        school.save()
    elif school is None:
        school = School.objects.create(
            name=request_obj.name,
            code=f"UDISE-{request_obj.udise_code}",
            city=request_obj.city,
            address=request_obj.address,
            udise_code=request_obj.udise_code,
            board=request_obj.board,
            pincode=request_obj.pincode,
            logo=request_obj.logo.name,
            active=False,
        )
    elif not school.logo or use_new_logo:
        school.logo = request_obj.logo.name
        school.save(update_fields=["logo", "updated_at"])

    request_obj.store.schools.add(school)
    request_obj.status = SchoolRequest.Status.APPROVED
    request_obj.school = school
    request_obj.reviewed_by = reviewer
    request_obj.reviewed_at = timezone.now()
    request_obj.save(update_fields=["status", "school", "reviewed_by", "reviewed_at", "updated_at"])

    log_audit_event(
        action=AuditLog.Action.SCHOOL_REQUEST_APPROVED,
        target_type="SchoolRequest",
        target_id=request_obj.pk,
        actor=reviewer,
        details={
            "store": request_obj.store.name,
            "udise_code": request_obj.udise_code,
            "school_id": str(school.pk),
            "school": school.name,
        },
        request=http_request,
    )
    return request_obj


@transaction.atomic
def reject_request(request_id, reviewer, reason: str, http_request=None) -> SchoolRequest:
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"reason": "Tell the retailer why the request is rejected."})
    request_obj = _locked_pending(request_id)
    request_obj.status = SchoolRequest.Status.REJECTED
    request_obj.reject_reason = reason
    request_obj.reviewed_by = reviewer
    request_obj.reviewed_at = timezone.now()
    request_obj.save(update_fields=["status", "reject_reason", "reviewed_by", "reviewed_at", "updated_at"])

    log_audit_event(
        action=AuditLog.Action.SCHOOL_REQUEST_REJECTED,
        target_type="SchoolRequest",
        target_id=request_obj.pk,
        actor=reviewer,
        details={"store": request_obj.store.name, "udise_code": request_obj.udise_code, "reason": reason},
        request=http_request,
    )
    return request_obj
