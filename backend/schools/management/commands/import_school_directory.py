import json
import re
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from common.cache_utils import invalidate_school_cache
from schools.models import City, School, SchoolBranch

DEFAULT_FILE = Path(__file__).resolve().parents[2] / "data" / "north_india_schools.json"

STATE_CODES = {
    "Delhi": "DL", "Chandigarh": "CH", "Haryana": "HR", "Punjab": "PB",
    "Himachal Pradesh": "HP", "Uttarakhand": "UK", "Jammu and Kashmir": "JK",
    "Ladakh": "LA", "Rajasthan": "RJ", "Uttar Pradesh": "UP", "Gujarat": "GJ",
}


class Command(BaseCommand):
    help = (
        "Import school chains and their branches (state, city, campus, address) from the "
        "school directory file made by scripts/school_directory/clean.py. Safe to run again: "
        "branches are matched on their Google Maps place id and updated."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", nargs="?", default=str(DEFAULT_FILE))
        parser.add_argument(
            "--only", default="",
            help="Comma separated chain codes to import (e.g. KV,APS). Default: all.",
        )
        parser.add_argument(
            "--inactive-fit", default="Poor",
            help="Comma separated fit ratings whose schools are created inactive (default: Poor, "
            "the chains that sell through their own shops or tenders). Pass '' to make all active.",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        path = Path(opts["file"])
        if not path.exists():
            raise CommandError(f"{path} not found. Run scripts/school_directory/clean.py first.")
        data = json.loads(path.read_text(encoding="utf8"))
        only = {c.strip().upper() for c in opts["only"].split(",") if c.strip()}
        inactive_fit = {f.strip().lower() for f in opts["inactive_fit"].split(",") if f.strip()}
        branches = [b for b in data["branches"] if not only or b["chain"] in only]

        with transaction.atomic():
            schools = self._schools(data["chains"], only, inactive_fit)
            cities = self._cities(branches)
            created, updated = self._branches(branches, schools, cities)
            if opts["dry_run"]:
                transaction.set_rollback(True)
        invalidate_school_cache()

        verb = "Would import" if opts["dry_run"] else "Imported"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {len(schools)} schools, {len(cities)} cities, "
            f"{created} new and {updated} updated branches."
        ))

    def _schools(self, chains, only, inactive_fit):
        schools = {}
        for code, info in chains.items():
            if only and code not in only:
                continue
            school, made = School.objects.get_or_create(
                code=f"CHAIN-{code}",
                defaults={
                    "name": info["name"],
                    "board": info["board"],
                    "active": info["fit"].lower() not in inactive_fit,
                },
            )
            schools[code] = school
            if not made and school.name != info["name"]:
                school.name = info["name"]
                school.save(update_fields=["name", "updated_at"])
        return schools

    def _cities(self, branches):
        cities = {}
        taken = set(City.objects.values_list("code", flat=True))
        for state, name in sorted({(b["state"], b["city"]) for b in branches}):
            city = City.objects.filter(state__iexact=state, name__iexact=name).first()
            if city is None:
                base = f"{STATE_CODES.get(state, 'IN')}-{re.sub(r'[^A-Z]', '', name.upper())}"[:20]
                code, n = base, 2
                while code in taken:
                    code = f"{base[:17]}-{n}"
                    n += 1
                taken.add(code)
                city = City.objects.create(name=name, state=state, code=code)
            cities[(state, name)] = city
        return cities

    def _branches(self, branches, schools, cities):
        existing = SchoolBranch.objects.in_bulk(
            [b["maps_place_id"] for b in branches], field_name="maps_place_id"
        )
        existing_by_name = {
            (sb.school_id, sb.city_id, sb.name): sb
            for sb in SchoolBranch.objects.filter(
                school_id__in=[s.id for s in schools.values()],
                city_id__in=[c.id for c in cities.values()],
            )
        }
        fields = ("name", "address", "pincode", "latitude", "longitude", "phone", "website", "maps_place_id")
        new, changed = [], []
        for b in branches:
            values = {
                "school": schools[b["chain"]],
                "city": cities[(b["state"], b["city"])],
                "name": b["name"][:200],
                "address": b["address"],
                "pincode": b["pincode"][:6],
                "latitude": Decimal(str(b["latitude"])),
                "longitude": Decimal(str(b["longitude"])),
                "phone": b["phone"][:20],
                "website": b["website"][:300],
            }
            row = existing.get(b["maps_place_id"])
            if row is None:
                row = existing_by_name.get((values["school"].id, values["city"].id, values["name"]))
            if row is None:
                sb = SchoolBranch(maps_place_id=b["maps_place_id"], **values)
                new.append(sb)
                existing_by_name[(values["school"].id, values["city"].id, values["name"])] = sb
            else:
                row.maps_place_id = b["maps_place_id"]
                # The shop owner may have moved or renamed a branch: keep school, city and active.
                for f in ("name", "address", "pincode", "latitude", "longitude", "phone", "website"):
                    setattr(row, f, values[f])
                changed.append(row)
        SchoolBranch.objects.bulk_create(new, batch_size=500)
        SchoolBranch.objects.bulk_update(changed, fields, batch_size=500)
        return len(new), len(changed)
