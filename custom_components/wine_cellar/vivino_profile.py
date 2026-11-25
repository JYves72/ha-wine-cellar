"""Vivino "profile" of a bottle: taste, flavours, style, awards and critic
reviews — what the Vivino app shows on a wine's page, beyond the rating.

The data comes from public api.vivino.com endpoints (see
``VivinoClient.get_vivino_profile``) and is applied in one place,
``async_apply_vivino_profile``. It is Vivino's own data, stored in
``vivino_*`` fields and simply replaced on each refresh. The drinking
window is *not* handled here: ``_apply_vivino_window`` in websocket.py
already owns it.

Which id is which: a bottle imported by the Vivino account sync (``source``
in ``VINTAGE_ID_SOURCES``) carries a *vintage* id in ``vivino_id``; every
other bottle (search, barcode, label, linked page) carries a *wine* id. The
two id spaces overlap, so the kind of id decides the lookup, and the result
is still checked against the bottle before it is kept.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN, VINTAGE_ID_SOURCES

_LOGGER = logging.getLogger(__name__)

PROFILE_FIELDS = (
    "vivino_taste",
    "vivino_flavors",
    "vivino_style",
    "vivino_awards",
    "vivino_critics",
)
# Cleared together with the Vivino link when a match is rejected.
PROFILE_CLEAR = {
    "vivino_taste": None,
    "vivino_flavors": [],
    "vivino_style": "",
    "vivino_awards": [],
    "vivino_critics": [],
    "vivino_profile_at": "",
}
_LIST_FIELDS = ("vivino_flavors", "vivino_awards", "vivino_critics")
# Wines looked up per background pass after a sync (sequential, gentle).
BACKFILL_LIMIT = 80
BACKFILL_PAUSE = 0.3


def holds_vintage_id(wine: dict[str, Any]) -> bool:
    """Does this bottle's vivino_id name a vintage (account sync) or a wine?"""
    # A synced bottle whose page was changed: only the original id is a vintage.
    if wine.get("vivino_sync_id"):
        return wine.get("vivino_id") == wine["vivino_sync_id"]
    # A page linked by hand is a wine page, whatever the bottle's origin.
    if wine.get("vivino_linked"):
        return False
    return wine.get("source") in VINTAGE_ID_SOURCES


def build_profile_updates(profile: dict[str, Any]) -> dict[str, Any]:
    """The wine updates a fetched profile implies (pure, for testing).

    Missing parts are written empty, so a refresh also clears what Vivino
    no longer shows.
    """
    updates: dict[str, Any] = {}
    for key in PROFILE_FIELDS:
        value = profile.get(key)
        if value:
            updates[key] = value
        else:
            updates[key] = [] if key in _LIST_FIELDS else ("" if key == "vivino_style" else None)
    updates["vivino_profile_at"] = datetime.now(timezone.utc).isoformat()
    return updates


async def _resolve_profile(
    vivino: Any, wine: dict[str, Any], language: str
) -> dict[str, Any] | None:
    """Fetch the profile of this bottle's vintage, checked against the bottle."""
    from .websocket import _vivino_match_is_trustworthy

    vid = wine.get("vivino_id")
    if not vid:
        return None
    if holds_vintage_id(wine):
        vintage_id = vid
    else:
        vintage_id = await vivino.find_vintage_id(vid, wine.get("vintage"))
        if not vintage_id:
            return None
    profile = await vivino.get_vivino_profile(vintage_id, language)
    if not profile:
        return None
    # A page the user linked by hand is trusted as is, like everywhere else.
    if not wine.get("vivino_linked") and not _vivino_match_is_trustworthy(wine, profile):
        _LOGGER.debug(
            "Vivino profile for %s looks like another wine (%s %s), not kept",
            wine.get("id"), profile.get("winery"), profile.get("name"),
        )
        return None
    return profile


async def async_apply_vivino_profile(
    hass: HomeAssistant, wine_id: str, *, save: bool = True
) -> bool:
    """Fetch and apply the Vivino profile of one bottle. True if found.

    Never raises: a profile is a bonus and must not break the caller.
    """
    from .websocket import _get_metadata_language, _propagate_to_duplicates

    domain_data = hass.data.get(DOMAIN) or {}
    storage = domain_data.get("storage")
    vivino = domain_data.get("vivino")
    wine = storage.get_wine(wine_id) if storage else None
    if not wine or not vivino or not wine.get("vivino_id"):
        return False
    looked_up_id = wine["vivino_id"]
    try:
        profile = await _resolve_profile(vivino, wine, _get_metadata_language(hass))
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Vivino profile for %s failed: %s", wine_id, err)
        return False
    # The link may have been removed or changed while we were fetching
    # (e.g. "wrong wine"): don't bring the old page's profile back.
    current = storage.get_wine(wine_id)
    if not current or current.get("vivino_id") != looked_up_id:
        return False
    if profile:
        updates = build_profile_updates(profile)
    else:
        # Remember we looked, so the backfill does not retry it every sync.
        updates = {"vivino_profile_at": datetime.now(timezone.utc).isoformat()}
    updated = storage.update_wine(wine_id, updates)
    if updated:
        _propagate_to_duplicates(storage, updated, updates)
    if save:
        await storage.async_save()
        hass.bus.async_fire(f"{DOMAIN}_updated")
    return bool(profile)


async def async_backfill_vivino_profiles(hass: HomeAssistant, force: bool = False) -> int:
    """Fill the profile of bottles that never got one (e.g. after a sync).

    One lookup per Vivino id (identical bottles share it and get it through
    the usual duplicate propagation), sequential with a short pause so a
    large cellar does not hammer Vivino.
    """
    domain_data = hass.data.get(DOMAIN) or {}
    storage = domain_data.get("storage")
    if not storage or not domain_data.get("vivino"):
        return 0
    todo: dict[str, str] = {}
    for w in storage.wines:
        if w.get("vivino_id") and (force or not w.get("vivino_profile_at")):
            todo.setdefault(str(w["vivino_id"]), w["id"])
    found = 0
    for i, wine_id in enumerate(list(todo.values())[:BACKFILL_LIMIT]):
        if i:
            await asyncio.sleep(BACKFILL_PAUSE)
        if await async_apply_vivino_profile(hass, wine_id, save=False):
            found += 1
    if todo:
        await storage.async_save()
        hass.bus.async_fire(f"{DOMAIN}_updated")
    _LOGGER.debug("Vivino profile backfill: %d of %d wines found", found, len(todo))
    return found
