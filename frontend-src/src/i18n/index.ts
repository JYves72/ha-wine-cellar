import en from "./en.json";
import fr from "./fr.json";

// The frontend's own translation catalog — separate from HA's own
// translations/{en,fr}.json (which only cover the config-flow screens; HA
// validates that file against its own schema, so it can't also carry
// arbitrary card UI strings). New languages are added here as another
// {lang}.json file plus one line in this map.
// Loosely typed on purpose: some groups (e.g. "ui") nest several levels
// deep ("ui.wineDetail.vintage"), others are flat one-level maps used with
// tGroup() — lookup()/tGroup() below navigate them dynamically either way.
const TRANSLATIONS: Record<string, any> = { en, fr };

// "spoiled" in removalReason groups every wine-side flaw (corked, volatile
// acidity, oxidized, off...) rather than physical bottle damage —
// "Défectueuse" (faulty wine) covers that better in French than a literal
// "Abîmée" (damaged).

// A single string, e.g. t("wineLocation.slot", hass.language). Dot-notation
// key into the catalog. Falls back to the English value for a language HA
// reports that this catalog doesn't have a file for, or for a key that
// exists in English but hasn't been translated into the target language
// yet — a partially-translated catalog should never render "undefined".
//
// `params` fills in {token} placeholders inside the resolved string, e.g.
// t("toast.wine.moved", lang, { name: wine.name }) against a catalog entry
// `"moved": "Moved \"{name}\""`. A placeholder with no matching param is
// left as-is rather than blanked out, so a missed param is visible in
// testing instead of silently disappearing.
export function t(key: string, language?: string, params?: Record<string, string | number>): string {
  const lang = (language || "en").split("-")[0];
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const value = lookup(dict, key);
  const resolved = value !== undefined ? value : lookup(TRANSLATIONS.en, key);
  const text = resolved !== undefined ? resolved : key;
  return params ? interpolate(text, params) : text;
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// A whole translated group at once (e.g. every wine-type label), for
// callers that need a Record to index into — Object.entries(), a lookup by
// a dynamic key, etc. — rather than calling t() one key at a time. Missing
// keys within a partially-translated group fall back individually to
// English rather than the whole group falling back.
export function tGroup(group: string, language?: string): Record<string, string> {
  const lang = (language || "en").split("-")[0];
  const enGroup = TRANSLATIONS.en[group] || {};
  if (lang === "en") return enGroup;
  const langGroup = TRANSLATIONS[lang]?.[group];
  return langGroup ? { ...enGroup, ...langGroup } : enGroup;
}

function lookup(dict: Record<string, any>, key: string): string | undefined {
  return key.split(".").reduce<any>((o, k) => (o && typeof o === "object" ? o[k] : undefined), dict);
}
