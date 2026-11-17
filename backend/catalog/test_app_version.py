from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient


class PublicAppVersionTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_app_version_endpoint_returns_version_info(self):
        url = reverse("public-app-version")
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("latest_version", data)
        self.assertIn("min_supported_version", data)
        self.assertIn("play_store_url", data)
        self.assertIn("latest_version_code", data)
        self.assertIn("min_supported_code", data)
        self.assertEqual(data["latest_version"], "1.0.0")
