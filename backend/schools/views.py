from rest_framework import viewsets
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import City, School, Student
from .serializers import CitySerializer, SchoolSerializer, StudentSerializer


class CityViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = City.objects.order_by("name")
    serializer_class = CitySerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS",)

    scope_city_field = "id"
    scope_school_field = None
    scope_parent_field = None

    def scope_queryset(self, qs):
        user = self.request.user
        if not user or not user.is_authenticated:
            return qs.none()
        if user.role == "BOSS" or getattr(user, "is_superuser", False):
            return qs
        if user.city_id:
            return qs.filter(id=user.city_id)
        return qs.none()


class SchoolViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = School.objects.select_related("city").order_by("name")
    serializer_class = SchoolSerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "id"
    scope_parent_field = None

    def scope_queryset(self, qs):
        user = self.request.user
        if not user or not user.is_authenticated:
            return qs.none()
        if user.role == "PARENT":
            if user.school_id:
                return qs.filter(id=user.school_id)
            return qs.none()
        return super().scope_queryset(qs)


class StudentViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    """
    Scoped Student ViewSet:
    - BOSS: all students
    - ADMIN: `WHERE city_id = user.city_id` (indexed by idx_student_city_school)
    - SCHOOL_ADMIN / TEACHER: `WHERE school_id = user.school_id` (indexed by idx_student_school_cls_sec)
    - PARENT: `WHERE parent_id = user.id` (indexed by idx_student_parent)
    """

    queryset = Student.objects.select_related("school").order_by(
        "school_id", "class_name", "section", "name"
    )
    serializer_class = StudentSerializer
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "PARENT")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = "parent_id"

    def get_queryset(self):
        qs = super().get_queryset()
        school_id = self.request.query_params.get("school")
        class_name = self.request.query_params.get("class_name") or self.request.query_params.get("class")
        section = self.request.query_params.get("section")
        gr_number = self.request.query_params.get("gr_number")

        if school_id:
            qs = qs.filter(school_id=school_id)
        if class_name:
            qs = qs.filter(class_name=class_name)
        if section:
            qs = qs.filter(section=section)
        if gr_number:
            qs = qs.filter(gr_number=gr_number)
        return qs
