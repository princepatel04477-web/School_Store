from rest_framework import status
from rest_framework.exceptions import APIException


class Conflict(APIException):
    """409 - the request conflicts with the current state of the resource."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "This action conflicts with the current state of the resource."
    default_code = "conflict"
