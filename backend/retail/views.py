from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsBoss
from schools.models import City, School

from .models import RetailStore, SchoolRequest
from .serializers import (
    ApproveSerializer,
    RejectSerializer,
    RetailerCreateSerializer,
    RetailStoreSerializer,
    SchoolRequestSerializer,
)
from .services import approve_request, reject_request

LOGO_CACHE = "public, max-age=86400"


def _is_boss(user) -> bool:
    return user.role == "BOSS" or getattr(user, "is_superuser", False)


class IsRetailerOrBoss(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (user.role == "RETAILER" or _is_boss(user)))


def _logo_response(field, cache_control: str) -> FileResponse:
    if not field:
        raise Http404("No logo.")
    try:
        response = FileResponse(field.open("rb"))
    except FileNotFoundError:
        raise Http404("No logo.")
    response["Cache-Control"] = cache_control
    response["X-Content-Type-Options"] = "nosniff"
    return response


class RetailerViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Boss: the retail shops and their logins."""

    permission_classes = [IsBoss]
    queryset = RetailStore.objects.select_related("owner", "city").prefetch_related("schools")
    serializer_class = RetailStoreSerializer

    def create(self, request, *args, **kwargs):
        serializer = RetailerCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        store = serializer.save()
        return Response(RetailStoreSerializer(store).data, status=status.HTTP_201_CREATED)


class MyStoreView(APIView):
    """Retailer: their own shop and the schools approved for it."""

    def get(self, request):
        if request.user.role != "RETAILER":
            raise PermissionDenied("Only retailers have a shop.")
        store = get_object_or_404(
            RetailStore.objects.select_related("owner", "city").prefetch_related("schools"),
            owner_id=request.user.id,
        )
        return Response(RetailStoreSerializer(store).data)


class RetailCitiesView(APIView):
    """Retailer: the cities a school request can be for."""

    permission_classes = [IsRetailerOrBoss]

    def get(self, request):
        cities = City.objects.filter(active=True).order_by("name").values("id", "name")
        return Response([{"id": str(c["id"]), "name": c["name"]} for c in cities])


class SchoolRequestViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Retailer: send a school request (multipart, with the logo) and see their own.
    Boss: see every request (?status=PENDING) and approve or reject it.
    """

    permission_classes = [IsRetailerOrBoss]
    serializer_class = SchoolRequestSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = SchoolRequest.objects.select_related("store", "city", "school", "reviewed_by")
        if not _is_boss(self.request.user):
            qs = qs.filter(store__owner_id=self.request.user.id)
        wanted = self.request.query_params.get("status")
        if wanted in SchoolRequest.Status.values:
            qs = qs.filter(status=wanted)
        return qs

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = page if page is not None else list(self.get_queryset())
        # One query for "is this school already on the store?" across the page.
        codes = {row.udise_code for row in rows if row.status == SchoolRequest.Status.PENDING}
        schools = {s.udise_code: s for s in School.objects.filter(udise_code__in=codes)} if codes else {}
        data = self.get_serializer(rows, many=True, context={**self.get_serializer_context(), "schools_by_udise": schools}).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "create":
            store = RetailStore.objects.filter(owner_id=self.request.user.id, active=True).first()
            if store is None:
                raise PermissionDenied("Your shop isn't set up or is switched off. Contact the store owner.")
            context["store"] = store
        return context

    def create(self, request, *args, **kwargs):
        if request.user.role != "RETAILER":
            raise PermissionDenied("Only retailers send school requests.")
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def logo(self, request, pk=None):
        return _logo_response(self.get_object().logo, "private, max-age=3600")

    @action(detail=True, methods=["post"], permission_classes=[IsBoss])
    def approve(self, request, pk=None):
        self.get_object()
        body = ApproveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        approved = approve_request(
            pk,
            request.user,
            link_school=body.validated_data.get("school"),
            use_new_logo=body.validated_data["use_new_logo"],
            http_request=request,
        )
        return Response(self.get_serializer(approved).data)

    @action(detail=True, methods=["post"], permission_classes=[IsBoss])
    def reject(self, request, pk=None):
        self.get_object()
        body = RejectSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        rejected = reject_request(pk, request.user, body.validated_data["reason"], http_request=request)
        return Response(self.get_serializer(rejected).data)


class PublicSchoolLogoView(APIView):
    """The school's logo, for the shop pages. Cached by browsers and the CDN for a day."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, school_id):
        school = get_object_or_404(School.objects.only("id", "logo"), pk=school_id)
        return _logo_response(school.logo, LOGO_CACHE)
