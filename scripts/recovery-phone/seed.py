"""Seed a throwaway local SQLite database for the phone run. Prints ids as JSON."""
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

BACKEND = Path(os.environ["SIM_BACKEND"])
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django  # noqa: E402

django.setup()

from accounts.models import User  # noqa: E402
from accounts.serializers import build_tokens_for_user  # noqa: E402
from catalog.models import Category, Product, ProductCityPrice, ProductVariant  # noqa: E402
from inventory.services import apply_stock_movement  # noqa: E402
from schools.models import City, School, Student  # noqa: E402

city, _ = City.objects.get_or_create(name="Surat", defaults={"code": "SUR"})
school, _ = School.objects.get_or_create(code="REVIEW-SCH", defaults={"name": "Review Public School", "city": city})
parent, _ = User.objects.get_or_create(
    username="review_parent", defaults={"role": "PARENT", "phone": "9999990001", "city": city, "school": school,
                                        "first_name": "Review", "last_name": "Parent"},
)
student, _ = Student.objects.get_or_create(
    gr_number="REV-001", school=school,
    defaults={"name": "Aarav Test", "class_name": "5", "section": "A", "gender": "boy", "parent": parent},
)
category, _ = Category.objects.get_or_create(slug="review-uniform", defaults={"name": "Uniform"})
variants = []
for sku, name, price in (("REV-SHIRT-M", "School Shirt", "450.00"), ("REV-TROUSER-M", "School Trousers", "350.00")):
    product, _ = Product.objects.get_or_create(
        name=name, school=school,
        defaults={"category": category, "gender": "unisex", "needs_review": False,
                  "cost_price": Decimal("200.00"), "selling_price": Decimal(price)},
    )
    variant, made = ProductVariant.objects.get_or_create(sku=sku, defaults={"product": product, "size": "M", "school": school})
    if made:
        apply_stock_movement(variant=variant, city_id=city.id, quantity_change=50, reason="INITIAL_STOCK")
    variants.append({"id": str(variant.id), "productId": str(product.id), "name": name, "pricePaise": int(Decimal(price) * 100)})

admin, _ = User.objects.get_or_create(username="review_city_admin", defaults={"role": "ADMIN", "city": city})
print(json.dumps({
    "school": str(school.id), "school_name": school.name, "student": str(student.id), "variants": variants,
    "admin_access": build_tokens_for_user(admin)["access"],
    "admin_refresh": build_tokens_for_user(admin)["refresh"],
}))
