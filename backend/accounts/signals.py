"""Keep each Supabase Auth account in step with its Django user (phase 2).

Only accounts that already exist in Supabase Auth are updated here; an account is created
there on its first password sign-in (accounts/supabase_auth.password_session). A change of
password in Django does not need copying: Django checks every password first, and the new
one reaches Supabase on the next sign-in.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from . import supabase_auth
from .models import User

logger = logging.getLogger(__name__)

SYNCED_FIELDS = {"username", "role", "city_id", "school_id", "branch_id", "all_schools_access",
                 "must_change_password", "is_active"}


def update_supabase_account(user_id) -> None:
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return
    try:
        supabase_auth.update_existing_user(user)
    except supabase_auth.SupabaseAuthError as err:
        logger.warning("could not update the Supabase account for %s: %s", user_id, err)


@receiver(post_save, sender=User, dispatch_uid="accounts.supabase_sync")
def sync_to_supabase(sender, instance, created, update_fields=None, raw=False, **kwargs):
    if raw or created or not supabase_auth.enabled():
        return
    if update_fields is not None and not (set(update_fields) & SYNCED_FIELDS):
        return
    transaction.on_commit(lambda: update_supabase_account(instance.pk))
