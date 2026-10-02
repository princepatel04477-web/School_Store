import uuid
from django.db import models


class UUIDModel(models.Model):
    """
    Base model using application-generated UUID v4 primary key (Rule P4).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True
