"""
Time series for the dashboard charts.

The rollup tables only hold days that had sales. A chart drawn from those rows
alone joins two sale days with one straight line and hides every quiet day in
between, so each series is filled out here: one point per bucket across the
whole range, zero where nothing sold.

Ranges up to about three months are daily, up to about a year weekly, longer
ones monthly, so a chart never carries more than about a hundred points.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Iterable, Mapping

DAY_LIMIT = 92
WEEK_LIMIT = 400


def pick_bucket(start: dt.date, end: dt.date) -> str:
    days = (end - start).days + 1
    if days <= DAY_LIMIT:
        return "day"
    if days <= WEEK_LIMIT:
        return "week"
    return "month"


def bucket_start(day: dt.date, bucket: str) -> dt.date:
    if bucket == "week":
        return day - dt.timedelta(days=day.weekday())
    if bucket == "month":
        return day.replace(day=1)
    return day


def _next_bucket(day: dt.date, bucket: str) -> dt.date:
    if bucket == "week":
        return day + dt.timedelta(days=7)
    if bucket == "month":
        return (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return day + dt.timedelta(days=1)


def fill_series(
    rows: Iterable[Mapping],
    start: dt.date,
    end: dt.date,
    fields: Mapping[str, int | Decimal],
    *,
    bucket: str | None = None,
    date_key: str = "date",
) -> tuple[str, list[dict]]:
    """
    Sum `rows` (each with a date and the numeric `fields`) into buckets and
    return every bucket from `start` to `end`, with each field's zero value
    where no row fell. A bucket's `date` is its first day inside the range.
    """
    bucket = bucket or pick_bucket(start, end)
    totals: dict[dt.date, dict] = {}
    for row in rows:
        day = row[date_key]
        if isinstance(day, dt.datetime):
            day = day.date()
        key = bucket_start(day, bucket)
        slot = totals.setdefault(key, {name: zero for name, zero in fields.items()})
        for name in fields:
            slot[name] += row.get(name) or 0

    points = []
    cursor = bucket_start(start, bucket)
    while cursor <= end:
        values = totals.get(cursor) or {name: zero for name, zero in fields.items()}
        points.append({"date": max(cursor, start), **values})
        cursor = _next_bucket(cursor, bucket)
    return bucket, points
