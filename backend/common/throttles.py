"""
Rate limiting for brute-force-sensitive endpoints (Prompt 4, requirement 6).

A parent claiming a child must guess a GR number, so the claim endpoint is
throttled per user *and* per IP. Rates live in
`REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]` so they can be tuned per environment.
"""

from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle


class StudentClaimUserThrottle(SimpleRateThrottle):
    """Throttle authenticated claim attempts per parent account."""

    scope = "student_claim_user"

    def get_rate(self):
        # Read at request time so the rate can be tuned via settings/env.
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": request.user.pk,
        }


class StudentClaimIPThrottle(SimpleRateThrottle):
    """Throttle claim attempts per client IP (also covers unauthenticated hits)."""

    scope = "student_claim_ip"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }
