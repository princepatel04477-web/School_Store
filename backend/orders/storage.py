"""
Storage service for direct-to-object-storage uploads and signed download URLs.
Supports AWS S3, Cloudflare R2, MinIO, or Local filesystem backend for development/testing.
"""

import os
import time
import hmac
import hashlib
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

from django.conf import settings
from django.urls import reverse


def get_storage_mode() -> str:
    """Returns 's3' if S3 credentials and bucket are configured, otherwise 'local'."""
    bucket = getattr(settings, "CUSTOMISATION_STORAGE_BUCKET", "") or os.environ.get("AWS_STORAGE_BUCKET_NAME", "")
    key = getattr(settings, "AWS_ACCESS_KEY_ID", "") or os.environ.get("AWS_ACCESS_KEY_ID", "")
    secret = getattr(settings, "AWS_SECRET_ACCESS_KEY", "") or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    if bucket and key and secret:
        return "s3"
    return "local"


def get_s3_client():
    import boto3
    from botocore.config import Config

    endpoint_url = getattr(settings, "AWS_S3_ENDPOINT_URL", None) or os.environ.get("AWS_S3_ENDPOINT_URL")
    region_name = getattr(settings, "AWS_S3_REGION_NAME", "us-east-1") or os.environ.get("AWS_S3_REGION_NAME", "us-east-1")
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region_name,
        aws_access_key_id=getattr(settings, "AWS_ACCESS_KEY_ID", None) or os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=getattr(settings, "AWS_SECRET_ACCESS_KEY", None) or os.environ.get("AWS_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4"),
    )


def generate_presigned_upload(
    file_key: str,
    content_type: str,
    max_bytes: int = 1_500_000,
    expires_in: int = 300,
) -> dict[str, Any]:
    """
    Generate a pre-signed direct upload URL + form fields / headers.
    The browser POSTs or PUTs directly to the object storage endpoint,
    keeping heavy bytes off the Django API server and workers.
    """
    mode = get_storage_mode()
    bucket = getattr(settings, "CUSTOMISATION_STORAGE_BUCKET", "") or os.environ.get("AWS_STORAGE_BUCKET_NAME", "school-store-private")

    if mode == "s3":
        s3 = get_s3_client()
        # Generates a presigned POST policy with exact key, content-type and content-length-range
        presigned = s3.generate_presigned_post(
            Bucket=bucket,
            Key=file_key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", 100, max_bytes],
            ],
            ExpiresIn=expires_in,
        )
        return {
            "method": "POST",
            "upload_url": presigned["url"],
            "fields": presigned["fields"],
            "file_key": file_key,
            "expires_in": expires_in,
        }

    # Local fallback for tests and development without live S3 credentials
    # Generates a signed direct-upload endpoint that emulates the direct bucket upload
    secret = settings.SECRET_KEY.encode("utf-8")
    expires_at = int(time.time()) + expires_in
    signature_payload = f"{file_key}:{expires_at}:{content_type}".encode("utf-8")
    sig = hmac.new(secret, signature_payload, hashlib.sha256).hexdigest()

    local_url = reverse("local-storage-upload")
    query = urlencode({
        "key": file_key,
        "expires": expires_at,
        "signature": sig,
        "content_type": content_type,
    })
    upload_url = f"{local_url}?{query}"

    return {
        "method": "PUT",
        "upload_url": upload_url,
        "fields": {},
        "file_key": file_key,
        "expires_in": expires_in,
    }


def generate_presigned_download(file_key: str, expires_in: int = 900) -> str:
    """
    Generate a short-lived expiring URL for a private stored object.
    Only authorized parents and staff may request this URL.
    """
    if not file_key:
        return ""

    mode = get_storage_mode()
    bucket = getattr(settings, "CUSTOMISATION_STORAGE_BUCKET", "") or os.environ.get("AWS_STORAGE_BUCKET_NAME", "school-store-private")

    if mode == "s3":
        s3 = get_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": file_key},
            ExpiresIn=expires_in,
        )

    # Local storage fallback
    secret = settings.SECRET_KEY.encode("utf-8")
    expires_at = int(time.time()) + expires_in
    signature_payload = f"get:{file_key}:{expires_at}".encode("utf-8")
    sig = hmac.new(secret, signature_payload, hashlib.sha256).hexdigest()

    local_url = reverse("local-storage-download")
    query = urlencode({
        "key": file_key,
        "expires": expires_at,
        "signature": sig,
    })
    return f"{local_url}?{query}"


def get_object_bytes(file_key: str) -> bytes:
    """Read the raw bytes for server-side validation / processing."""
    mode = get_storage_mode()
    bucket = getattr(settings, "CUSTOMISATION_STORAGE_BUCKET", "") or os.environ.get("AWS_STORAGE_BUCKET_NAME", "school-store-private")

    if mode == "s3":
        s3 = get_s3_client()
        resp = s3.get_object(Bucket=bucket, Key=file_key)
        return resp["Body"].read()

    # Local filesystem
    storage_dir = getattr(settings, "CUSTOMISATION_LOCAL_DIR", settings.MEDIA_ROOT / "customisations")
    path = os.path.join(storage_dir, file_key.replace("/", os.sep))
    if not os.path.exists(path):
        raise FileNotFoundError(f"File key {file_key} does not exist in local storage.")
    with open(path, "rb") as f:
        return f.read()


def put_object_bytes(file_key: str, data: bytes, content_type: str = "image/jpeg"):
    """Write processed object bytes (e.g. print-ready or thumbnail)."""
    mode = get_storage_mode()
    bucket = getattr(settings, "CUSTOMISATION_STORAGE_BUCKET", "") or os.environ.get("AWS_STORAGE_BUCKET_NAME", "school-store-private")

    if mode == "s3":
        s3 = get_s3_client()
        s3.put_object(
            Bucket=bucket,
            Key=file_key,
            Body=data,
            ContentType=content_type,
        )
        return

    # Local filesystem
    storage_dir = getattr(settings, "CUSTOMISATION_LOCAL_DIR", settings.MEDIA_ROOT / "customisations")
    path = os.path.join(storage_dir, file_key.replace("/", os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
