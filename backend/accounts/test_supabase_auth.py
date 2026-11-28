"""Phase 2: Supabase Auth issues access tokens; Django keeps checking passwords and sessions."""

import json
import time
import uuid
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import supabase_auth
from accounts.models import User
from accounts.revocation import revoke_sessions

ISSUER = "http://db.test:8100/auth/v1"
SB = dict(
    SUPABASE_AUTH_URL=ISSUER,
    SUPABASE_ANON_KEY="anon",
    SUPABASE_SERVICE_ROLE_KEY="service",
    SUPABASE_AUTH_ISSUER=ISSUER,
)

_PRIVATE = ec.generate_private_key(ec.SECP256R1())
_KID = "test-key"
_JWK = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(_PRIVATE.public_key()))
_JWK.update({"kid": _KID, "alg": "ES256", "use": "sig"})


def supabase_token(user, *, issuer=ISSUER, store_role=True, iat=None, **meta):
    now = int(time.time()) if iat is None else iat
    app_metadata = supabase_auth.app_metadata(user)
    if not store_role:
        app_metadata.pop("store_role")
    app_metadata.update(meta)
    payload = {"sub": str(user.id), "aud": "authenticated", "iss": issuer, "iat": now, "exp": now + 3600,
               "role": "authenticated", "app_metadata": app_metadata}
    return jwt.encode(payload, _PRIVATE, algorithm="ES256", headers={"kid": _KID})


class FakeGoTrue:
    """Just enough of Supabase Auth: admin users, password and refresh grants, JWKS."""

    def __init__(self):
        self.users = {}       # id -> {"password", "app_metadata", "ban_duration"}
        self.refresh = {}     # refresh token -> user id (single use)
        self.calls = []
        self.down = False

    def __call__(self, method, path, *, body=None, key=None, bearer=None):
        self.calls.append((method, path))
        if self.down:
            raise supabase_auth.SupabaseAuthError("unreachable")
        if path == "/.well-known/jwks.json":
            return {"keys": [_JWK]}
        if path.startswith("/admin/users/") and method == "PUT":
            uid = path.rsplit("/", 1)[1]
            if uid not in self.users:
                raise supabase_auth.SupabaseAuthError("missing", 404)
            self.users[uid].update({k: v for k, v in body.items() if k in ("password", "app_metadata", "ban_duration")})
            return {"id": uid}
        if path == "/admin/users" and method == "POST":
            self.users[body["id"]] = {"password": body["password"], "app_metadata": body["app_metadata"]}
            return {"id": body["id"]}
        if path == "/token?grant_type=password":
            uid = body["email"].split("@")[0]
            if self.users.get(uid, {}).get("password") != body["password"]:
                raise supabase_auth.SupabaseAuthError("invalid", 400)
            return self._session(uid)
        if path == "/token?grant_type=refresh_token":
            uid = self.refresh.pop(body["refresh_token"], None)
            if uid is None:
                raise supabase_auth.SupabaseAuthError("used", 400)
            return self._session(uid)
        raise AssertionError(f"unexpected {method} {path}")

    def _session(self, uid):
        user = User.objects.get(pk=uid)
        meta = self.users[uid].get("app_metadata") or supabase_auth.app_metadata(user)
        token = supabase_token(user, **{k: v for k, v in meta.items() if k != "store_role"})
        rt = uuid.uuid4().hex
        self.refresh[rt] = uid
        return {"access_token": token, "refresh_token": rt}


@override_settings(**SB)
class SupabaseSignInTests(TestCase):
    def setUp(self):
        cache.clear()
        self.gotrue = FakeGoTrue()
        patcher = mock.patch.object(supabase_auth, "_request", self.gotrue)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="boss1", password="Right-pass-123", role=User.Role.BOSS)
        self.client = APIClient()

    def login(self, password="Right-pass-123", username="boss1"):
        return self.client.post("/api/auth/token/", {"username": username, "password": password}, format="json")

    def test_password_sign_in_returns_a_supabase_access_token_and_copies_the_password(self):
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(jwt.get_unverified_header(res.data["access"])["alg"], "ES256")
        self.assertEqual(jwt.get_unverified_header(res.data["refresh"])["alg"], "HS256")  # Django keeps the refresh
        self.assertEqual(self.gotrue.users[str(self.user.id)]["password"], "Right-pass-123")
        self.assertEqual(res.data["user"]["username"], "boss1")

    def test_wrong_password_never_reaches_supabase(self):
        res = self.login(password="wrong")
        self.assertEqual(res.status_code, 401)
        self.assertFalse([c for c in self.gotrue.calls if "grant_type=password" in c[1]])

    def test_supabase_down_falls_back_to_a_django_token(self):
        self.gotrue.down = True
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(jwt.get_unverified_header(res.data["access"])["alg"], "HS256")

    def test_a_changed_django_password_is_carried_over_and_the_old_one_stops_working(self):
        self.login()
        self.user.set_password("New-pass-456")
        self.user.save()
        self.assertEqual(self.login(password="Right-pass-123").status_code, 401)  # Django refuses first
        res = self.login(password="New-pass-456")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.gotrue.users[str(self.user.id)]["password"], "New-pass-456")

    def test_the_supabase_token_works_on_django_endpoints(self):
        access = self.login().data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "boss1")

    def test_refresh_keeps_issuing_supabase_tokens_with_the_same_django_refresh_token(self):
        refresh = self.login().data["refresh"]
        for _ in range(3):  # the website re-sends its first refresh token every time
            res = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(jwt.get_unverified_header(res.data["access"])["alg"], "ES256")

    def test_refresh_without_a_stored_session_falls_back_to_django(self):
        self.gotrue.down = True
        refresh = self.login().data["refresh"]
        self.gotrue.down = False
        res = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(jwt.get_unverified_header(res.data["access"])["alg"], "HS256")

    def test_a_revoked_sign_in_cannot_refresh_or_use_its_supabase_token(self):
        data = self.login().data
        time.sleep(1)
        revoke_sessions(self.user.id)
        res = self.client.post("/api/auth/token/refresh/", {"refresh": data["refresh"]}, format="json")
        self.assertEqual(res.status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {data['access']}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)


@override_settings(**SB)
class SupabaseTokenCheckTests(TestCase):
    def setUp(self):
        cache.clear()
        self.gotrue = FakeGoTrue()
        patcher = mock.patch.object(supabase_auth, "_request", self.gotrue)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="admin1", password="x-123456789", role=User.Role.ADMIN)
        self.client = APIClient()

    def me(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return self.client.get("/api/auth/me/")

    def test_claims_come_from_app_metadata(self):
        from accounts.authentication import supabase_claims

        claims = supabase_claims(supabase_token(self.user))
        self.assertEqual(claims["user_id"], str(self.user.id))
        self.assertEqual(claims["role"], User.Role.ADMIN)
        self.assertEqual(claims["username"], "admin1")

    def test_wrong_issuer_is_refused(self):
        self.assertEqual(self.me(supabase_token(self.user, issuer="http://elsewhere/auth/v1")).status_code, 401)

    def test_a_supabase_user_without_a_store_role_is_refused(self):
        self.assertEqual(self.me(supabase_token(self.user, store_role=False)).status_code, 401)

    def test_a_token_from_another_key_is_refused(self):
        other = ec.generate_private_key(ec.SECP256R1())
        token = jwt.encode({"sub": str(self.user.id), "aud": "authenticated", "iss": ISSUER,
                            "iat": int(time.time()), "exp": int(time.time()) + 60,
                            "app_metadata": supabase_auth.app_metadata(self.user)},
                           other, algorithm="ES256", headers={"kid": _KID})
        self.assertEqual(self.me(token).status_code, 401)

    @override_settings(SUPABASE_AUTH_URL="", SUPABASE_SERVICE_ROLE_KEY="")
    def test_supabase_tokens_are_refused_when_supabase_auth_is_off(self):
        self.assertEqual(self.me(supabase_token(self.user)).status_code, 401)


@override_settings(**SB)
class SupabaseAccountSyncTests(TestCase):
    def setUp(self):
        cache.clear()
        self.gotrue = FakeGoTrue()
        patcher = mock.patch.object(supabase_auth, "_request", self.gotrue)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(username="t1", password="Teach-123456", role=User.Role.TEACHER)

    def test_role_and_pause_reach_an_existing_supabase_account(self):
        supabase_auth.sync_user(self.user, password="Teach-123456")
        with self.captureOnCommitCallbacks(execute=True):
            self.user.all_schools_access = True
            self.user.is_active = False
            self.user.save()
        stored = self.gotrue.users[str(self.user.id)]
        self.assertTrue(stored["app_metadata"]["all_schools_access"])
        self.assertEqual(stored["ban_duration"], "876000h")

    def test_accounts_that_never_signed_in_through_supabase_are_not_created_on_save(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.user.role = User.Role.ADMIN
            self.user.save()
        self.assertNotIn(str(self.user.id), self.gotrue.users)

    def test_new_supabase_accounts_get_a_random_password_when_none_is_given(self):
        supabase_auth.sync_user(self.user)
        self.assertNotEqual(self.gotrue.users[str(self.user.id)]["password"], "Teach-123456")
