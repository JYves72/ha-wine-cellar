"""Compute the drink-now / hold / past-peak badge shown on the rack view.

Cork Dork's ``disposition`` field ("D" / "H" / "P" / "") drives the small
colored badge (or ring) on ``wine-cellar-card`` in the frontend.

``disposition`` is always a pure function of the wine's own recorded
``drink_by``/``drink_window`` and today's date — see ``compute_disposition``
below — recomputed on every Home Assistant startup, once a day, and
whenever those fields are edited (``wine_storage.py``'s ``update_wine``).
There is no UI path for a human to pick D/H/P directly, and Gemini AI
(``gemini.py``) always sets ``disposition`` together with ``drink_by``/
``drink_window`` in the same call, so this recompute isn't overriding a
separate judgment — it's just keeping the badge in sync with whatever
window is actually on the wine right now. An earlier version of this
module tried to "protect" a disposition set some other way by never
touching it again once `disposition_source` wasn't "auto" — in practice
that meant any wine ever touched by AI, or predating this feature, got
permanently frozen at whatever it first computed to, drifting wrong as
the calendar moved on. Given there's nothing else to protect it from,
that gate was removed: disposition_source now only records that this
module computed the value, not a permission check on future recomputes.

Rule (as of 12 Sep 2026 — replaces an "ends soon" rule from three weeks
earlier that read a wine as "H" for as long as its window's end year was
more than a year out, even while sitting squarely inside a long window
today; the cellar owner found that unintuitive in practice: a 2024-2028
window in 2026 is a wine you're supposed to be drinking *right now*, not
one to keep holding):

- "D" (drink now) when today falls inside the window: its start year has
  arrived (or there is no recorded start year at all) and its end year
  hasn't passed yet.
- "H" (hold) when the window's start year hasn't arrived yet.
- "P" (past peak) once the window's end year is already behind us.
- Wines with no parseable year anywhere (e.g. "Drink soon - within ~1-2
  years of purchase") default to "D", since that phrasing is used for
  wines meant to be drunk shortly after purchase.
- A single recorded year with no range (just ``drink_by``, or a
  ``drink_window`` that's one bare year rather than "start-end") is
  treated as an end year only — there's no declared start to hold against,
  so it reads "D" any time up to that year and "P" after.

Because this is a function of "the current year", the result silently
changes as the calendar rolls over — a wine sitting at "H" because its
window starts in 2028 will correctly flip to "D" once the current year
reaches 2028, but *only* once something calls ``recompute_all`` again.
That's why ``__init__.py`` wires this up to run both on every Home
Assistant startup and once a day, rather than once at add-time.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

DISPOSITION_DRINK_NOW = "D"
DISPOSITION_HOLD = "H"
DISPOSITION_PAST_PEAK = "P"

# Marks a wine's `disposition` as having been set by this module (as
# opposed to Gemini AI, which writes its own value straight to storage
# without this marker). Purely informational at this point — see the
# module docstring — kept so a future feature that does need to tell the
# two apart doesn't have to re-add the bookkeeping.
DISPOSITION_SOURCE_AUTO = "auto"


def compute_disposition(wine: dict[str, Any], *, current_year: int | None = None) -> str:
    """Return 'D', 'H', or 'P' for a single wine, based on its drink window.

    ``current_year`` is injectable for testing; defaults to the real
    current year.
    """
    if current_year is None:
        current_year = datetime.now().year

    drink_window = (wine.get("drink_window") or "").strip()
    drink_by = (wine.get("drink_by") or "").strip()

    years = [int(match.group(0)) for match in _YEAR_RE.finditer(drink_window)]
    start_year: int | None = None
    end_year: int | None = None
    if len(years) >= 2:
        # A real "start-end" range — first year found is the start, last is
        # the end, regardless of how many years show up in between (free
        # text drink_window values aren't always exactly two numbers).
        start_year, end_year = years[0], years[-1]
    elif years:
        end_year = years[0]
    elif drink_by.isdigit():
        end_year = int(drink_by)

    if end_year is None:
        # No parseable year anywhere on this wine. These are consistently
        # "drink soon" style entries in practice (see module docstring).
        return DISPOSITION_DRINK_NOW

    if current_year > end_year:
        return DISPOSITION_PAST_PEAK
    if start_year is not None and current_year < start_year:
        return DISPOSITION_HOLD
    return DISPOSITION_DRINK_NOW


def recompute_all(wines: list[dict[str, Any]], *, current_year: int | None = None) -> int:
    """Recompute `disposition` in place for every wine.

    Unconditional: every wine's `disposition` is set to whatever
    `compute_disposition` says right now, regardless of what it was before
    or how it got there — see the module docstring for why there's nothing
    left worth protecting it from.

    Returns the number of wines whose `disposition` changed.
    """
    changed = 0
    for wine in wines:
        new_value = compute_disposition(wine, current_year=current_year)
        if wine.get("disposition") != new_value or wine.get("disposition_source") != DISPOSITION_SOURCE_AUTO:
            wine["disposition"] = new_value
            wine["disposition_source"] = DISPOSITION_SOURCE_AUTO
            changed += 1

    return changed
