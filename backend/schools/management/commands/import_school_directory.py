import json
import re
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import CharField, Q, Value
from django.db.models.functions import Cast, Concat

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
        "school directory file made by scripts/school_directory (clean.py, then udise.py). Safe to "
        "run again: branches are matched on their UDISE+ code, then their Google Maps place id, "
        "and updated."
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
        parser.add_argument(
            "--deactivate-missing", action="store_true",
            help="Switch off imported branches (ones with a UDISE+ code or Google place id) of the "
            "imported schools that are no longer in the file. Nothing is deleted.",
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
            created, updated, kept_ids = self._branches(branches, schools, cities)
            switched_off = 0
            if opts["deactivate_missing"]:
                switched_off = (
                    SchoolBranch.objects.filter(school__in=schools.values(), active=True)
                    .filter(Q(udise_code__isnull=False) | Q(maps_place_id__isnull=False))
                    .exclude(id__in=kept_ids)
                    .update(active=False)
                )
            if opts["dry_run"]:
                transaction.set_rollback(True)
        invalidate_school_cache()

        verb = "Would import" if opts["dry_run"] else "Imported"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {len(schools)} schools, {len(cities)} cities, "
            f"{created} new and {updated} updated branches, {switched_off} switched off."
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
        by_udise = SchoolBranch.objects.in_bulk(
            [b["udise_code"] for b in branches if b.get("udise_code")], field_name="udise_code"
        )
        by_place = SchoolBranch.objects.in_bulk(
            [b["maps_place_id"] for b in branches if b.get("maps_place_id")], field_name="maps_place_id"
        )
        holders = {
            (sb.school_id, sb.city_id, sb.name): sb
            for sb in SchoolBranch.objects.filter(
                school_id__in=[s.id for s in schools.values()],
                city_id__in=[c.id for c in cities.values()],
            )
        }
        by_name = dict(holders)
        fields = ("name", "address", "pincode", "latitude", "longitude", "phone", "website",
                  "maps_place_id", "udise_code")
        new, changed, seen = [], [], set()
        for b in branches:
            values = {
                "school": schools[b["chain"]],
                "city": cities[(b["state"], b["city"])],
                "name": b["name"][:200],
                "address": b["address"],
                "pincode": (b["pincode"] or "")[:6],
                "latitude": Decimal(str(b["latitude"])) if b.get("latitude") is not None else None,
                "longitude": Decimal(str(b["longitude"])) if b.get("longitude") is not None else None,
                "phone": (b.get("phone") or "")[:20],
                "website": (b.get("website") or "")[:300],
                "maps_place_id": b.get("maps_place_id") or None,
                "udise_code": b.get("udise_code") or None,
            }
            row = (
                (values["udise_code"] and by_udise.get(values["udise_code"]))
                or (values["maps_place_id"] and by_place.get(values["maps_place_id"]))
                or by_name.get((values["school"].id, values["city"].id, values["name"]))
            )
            if row is not None and row.pk in seen:
                row = None  # already used by an earlier line of the file
            if row is None:
                row = SchoolBranch(**values)
                new.append(row)
            else:
                # The shop owner may have moved a branch or switched it off: keep school, city, active.
                for f in fields:
                    setattr(row, f, values[f])
                changed.append(row)
            seen.add(row.pk)
            by_name[(values["school"].id, values["city"].id, values["name"])] = row
        # A row the file no longer uses (a duplicate listing) may hold a name a line wants:
        # it keeps its name with "(old ...)" added.
        wanted = {(r.school_id, r.city_id, r.name) for r in changed + new}
        blockers = [sb for key, sb in holders.items() if sb.pk not in seen and key in wanted]
        for sb in blockers:
            sb.name = f"{sb.name[:180]} (old {str(sb.pk)[:8]})"
        SchoolBranch.objects.bulk_update(blockers, ["name"], batch_size=500)
        # Park the changing rows on temporary names and free their unique codes, so names
        # and codes can move between rows, then write the final values.
        SchoolBranch.objects.filter(pk__in=[r.pk for r in changed]).update(
            name=Concat(Value("~"), Cast("id", CharField())), maps_place_id=None, udise_code=None
        )
        SchoolBranch.objects.bulk_update(changed, fields, batch_size=500)
        SchoolBranch.objects.bulk_create(new, batch_size=500)
        return len(new), len(changed), seen
