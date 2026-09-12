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

Rule (as of 20 Aug 2026, chosen by the cellar owner after trying a broader
version first):

- "D" (drink now) only when the wine's drinking window *ends* in the
  current year or the next one. A wine can be squarely inside a long
  window (e.g. 2024-2032) today and still read "H" — the badge means
  "the window is closing soon", not merely "drinkable today".
- "H" (hold) otherwise, as long as the window hasn't fully closed yet.
- "P" (past peak) once the window's end year is already behind us.
- Wines with no parseable year anywhere (e.g. "Drink soon - within ~1-2
  years of purchase") default to "D", since that phrasing is used for
  wines meant to be drunk shortly after purchase.

Because this is a function of "the current year", the result silently
changes as the calendar rolls over — a wine sitting at "H" because its
window ends in 2028 will correctly flip to "D" once the current year
reaches 2027, but *only* once something calls ``recompute_all`` again.
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
    next_year = current_year + 1

    drink_window = (wine.get("drink_window") or "").strip()
    drink_by = (wine.get("drink_by") or "").strip()

    years = [int(match.group(0)) for match in _YEAR_RE.finditer(drink_window)]
    end_year: int | None = None
    if years:
        end_year = years[-1]
    elif drink_by.isdigit():
        end_year = int(drink_by)

    if end_year is None:
        # No parseable year anywhere on this wine. These are consistently
        # "drink soon" style entries in practice (see module docstring).
        return DISPOSITION_DRINK_NOW

    if end_year < current_year:
        return DISPOSITION_PAST_PEAK
    if end_year in (current_year, next_year):
        return DISPOSITION_DRINK_NOW
    return DISPOSITION_HOLD


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
