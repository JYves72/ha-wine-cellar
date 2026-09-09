"""Compute the drink-now / hold / past-peak badge shown on the rack view.

Cork Dork's ``disposition`` field ("D" / "H" / "P" / "") drives the small
colored badge on ``wine-cellar-card`` in the frontend. Upstream only ever
sets this field from the optional Gemini AI label-analysis feature
(``gemini.py``); a cellar without a Gemini API key configured never gets a
badge on any bottle, no matter how the free-text ``drink_window``/``drink_by``
fields read.

This module adds a second, independent way to populate ``disposition``: a
pure date-based computation from the wine's own recorded drinking window.
It never overwrites a value that Gemini (or a human) set directly — see
``disposition_source`` below — so it's safe to enable even on a cellar that
also uses the Gemini feature.

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

# Marks a wine whose `disposition` this module is allowed to keep managing.
# Set the first time we assign a disposition to a wine that didn't already
# have a Gemini- or human-assigned one. Any wine with a truthy `disposition`
# and a `disposition_source` other than "auto" is left alone forever.
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
    """Recompute `disposition` in place for every eligible wine.

    A wine is eligible if it has never been classified (`disposition` is
    falsy) or if this module set its current value (`disposition_source`
    == "auto"). Anything else - notably a Gemini AI classification, or a
    value a human typed in directly - is left untouched.

    Returns the number of wines whose `disposition` changed.
    """
    changed = 0
    for wine in wines:
        current = wine.get("disposition") or ""
        source = wine.get("disposition_source") or ""
        if current and source != DISPOSITION_SOURCE_AUTO:
            continue

        new_value = compute_disposition(wine, current_year=current_year)
        if wine.get("disposition") != new_value or source != DISPOSITION_SOURCE_AUTO:
            wine["disposition"] = new_value
            wine["disposition_source"] = DISPOSITION_SOURCE_AUTO
            changed += 1

    return changed
