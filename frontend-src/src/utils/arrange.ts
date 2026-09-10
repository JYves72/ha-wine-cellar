import { Cabinet, Wine, WineType, getWineTypeLabels, getShelfSlotGroups } from "../models";
import { drinkByYear, normalizeText } from "./search";
import {
  Container,
  containerKey,
  containerLabel,
  containerOf,
  containerUsage,
  containersOf,
  storageRowFor,
} from "./location";
import { cuveeKey } from "./suggest";
import { t } from "../i18n";

// Reading the cellar's current state back as advice.
//
// There are no declared zone rules to check against, so nothing here can say
// "this bottle is in the wrong place" — only "these bottles disagree with each
// other". Every finding is a disagreement inside the cellar's own arrangement,
// which is what makes it checkable without the user having configured anything.
//
// This runs once in a while — after scanning a cellar in, mostly — so it is
// deliberately conservative: a cellar always has some scatter, and a finding
// that fires on every small imperfection becomes a badge people learn to
// ignore.

export type FindingKind = "consolidate" | "outlier" | "buried";

export interface Move {
  wine: Wine;
  from: Container;
  to: Container;
  fromLabel: string;
  toLabel: string;
}

export interface Finding {
  // Stable across re-analysis: dismissing one has to keep it dismissed.
  id: string;
  kind: FindingKind;
  title: string;
  detail: string;
  wines: Wine[];
  // Empty when the fix is physical but not expressible as single moves — a
  // swap needs two bottles to trade places, and pretending otherwise would
  // write positions the cellar does not actually have.
  moves: Move[];
}

const MIN_GROUP_BOTTLES = 3;
const MIN_CONTAINER_BOTTLES = 4;
const DOMINANCE = 0.75;
const MAX_INTRUDERS = 2;

const groupKey = (w: Wine) =>
  `${cuveeKey(w.name)}|${normalizeText(w.winery).trim()}`.replace(/^\||\|$/g, "");

// A bottle whose window is closing: explicitly marked drink/past, or carrying a
// drink-by year that has arrived.
function isDrinkSoon(wine: Wine): boolean {
  const code = (wine.disposition || "").toUpperCase();
  if (code === "D" || code === "P") return true;
  const year = drinkByYear(wine);
  return year !== null && year <= new Date().getFullYear();
}

function isKeeper(wine: Wine): boolean {
  return (wine.disposition || "").toUpperCase() === "H" && !isDrinkSoon(wine);
}

// Containers that actually exist in the current rack layout. Bottles can
// outlive a deleted storage row, but proposing a move into one would be
// proposing a move into nothing.
function liveContainers(cabinets: Cabinet[]): Map<string, { container: Container; cabinet: Cabinet }> {
  const out = new Map<string, { container: Container; cabinet: Cabinet }>();
  for (const cabinet of cabinets) {
    for (const container of containersOf(cabinet)) {
      out.set(containerKey(container), { container, cabinet });
    }
  }
  return out;
}

function placedWines(wines: Wine[], live: ReturnType<typeof liveContainers>) {
  return wines
    .map((wine) => ({ wine, container: containerOf(wine) }))
    .filter(
      (x): x is { wine: Wine; container: Container } =>
        x.container !== null && live.has(containerKey(x.container))
    );
}

function dominantType(bottles: Wine[]): { type: WineType; share: number } | null {
  const counts = new Map<WineType, number>();
  for (const w of bottles) counts.set(w.type, (counts.get(w.type) || 0) + 1);
  let best: WineType | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  if (best === null) return null;
  return { type: best, share: bestCount / bottles.length };
}

// Bottles of one wine scattered across several places. The fix is real work,
// so only worth raising for a series big enough to be worth gathering.
function findScatter(
  placed: { wine: Wine; container: Container }[],
  live: ReturnType<typeof liveContainers>,
  cabinets: Cabinet[],
  wines: Wine[],
  language?: string
): Finding[] {
  const groups = new Map<string, { wine: Wine; container: Container }[]>();
  for (const entry of placed) {
    const k = groupKey(entry.wine);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(entry);
    else groups.set(k, [entry]);
  }

  const out: Finding[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < MIN_GROUP_BOTTLES) continue;
    const byContainer = new Map<string, { wine: Wine; container: Container }[]>();
    for (const e of entries) {
      const ck = containerKey(e.container);
      const list = byContainer.get(ck);
      if (list) list.push(e);
      else byContainer.set(ck, [e]);
    }
    if (byContainer.size < 2) continue;

    // Gather towards wherever most of the series already sits, preferring the
    // one that can actually take the rest.
    const candidates = [...byContainer.entries()]
      .map(([ck, held]) => {
        const entry = live.get(ck)!;
        const strays = entries.length - held.length;
        const usage = containerUsage(entry.container, entry.cabinet, wines);
        return { ck, held, strays, free: usage.free, container: entry.container };
      })
      .sort((a, b) => (b.free >= b.strays ? 1 : 0) - (a.free >= a.strays ? 1 : 0) || b.held.length - a.held.length || b.free - a.free);

    const target = candidates[0];
    if (!target || target.free < 1) continue;

    const strays = entries.filter((e) => containerKey(e.container) !== target.ck);
    const movable = strays.slice(0, Number.isFinite(target.free) ? target.free : strays.length);
    if (!movable.length) continue;

    const targetLabel = containerLabel(target.container, cabinets, language);
    const name = entries[0].wine.name || entries[0].wine.winery || t("ui.arrangement.findings.consolidateFallbackName", language);
    const partial = movable.length < strays.length;
    out.push({
      id: `consolidate:${key}`,
      kind: "consolidate",
      title: t("ui.arrangement.findings.consolidateTitle", language, {
        name,
        n: entries.length,
        plural: entries.length === 1 ? "" : "s",
        m: byContainer.size,
        placesPlural: byContainer.size === 1 ? "" : "s",
      }),
      detail: partial
        ? t("ui.arrangement.findings.consolidateDetailPartial", language, {
            targetLabel,
            held: target.held.length,
            movable: movable.length,
            strays: strays.length,
          })
        : t("ui.arrangement.findings.consolidateDetailFull", language, {
            targetLabel,
            held: target.held.length,
            movable: movable.length,
          }),
      wines: entries.map((e) => e.wine),
      moves: movable.map((e) => ({
        wine: e.wine,
        from: e.container,
        to: target.container,
        fromLabel: containerLabel(e.container, cabinets, language),
        toLabel: targetLabel,
      })),
    });
  }
  return out;
}

// A bin that is overwhelmingly one kind of wine, with a couple of bottles that
// are not. The bin's purpose was never declared, but at this concentration it
// plainly has one.
function findOutliers(
  placed: { wine: Wine; container: Container }[],
  live: ReturnType<typeof liveContainers>,
  cabinets: Cabinet[],
  wines: Wine[],
  language?: string
): Finding[] {
  const byContainer = new Map<string, Wine[]>();
  for (const e of placed) {
    const ck = containerKey(e.container);
    const list = byContainer.get(ck);
    if (list) list.push(e.wine);
    else byContainer.set(ck, [e.wine]);
  }

  // Where each type feels at home, for suggesting somewhere better.
  const homes = new Map<WineType, { container: Container; cabinet: Cabinet; count: number }[]>();
  for (const [ck, bottles] of byContainer) {
    const dom = dominantType(bottles);
    if (!dom || dom.share < DOMINANCE) continue;
    const entry = live.get(ck)!;
    const list = homes.get(dom.type) || [];
    list.push({ ...entry, count: bottles.filter((w) => w.type === dom.type).length });
    homes.set(dom.type, list);
  }

  const out: Finding[] = [];
  for (const [ck, bottles] of byContainer) {
    if (bottles.length < MIN_CONTAINER_BOTTLES) continue;
    const dom = dominantType(bottles);
    if (!dom || dom.share < DOMINANCE) continue;
    const intruders = bottles.filter((w) => w.type !== dom.type);
    if (!intruders.length || intruders.length > MAX_INTRUDERS) continue;

    const here = live.get(ck)!;
    const moves: Move[] = [];
    for (const wine of intruders) {
      const better = (homes.get(wine.type) || [])
        .filter((h) => containerKey(h.container) !== ck)
        .map((h) => ({ ...h, free: containerUsage(h.container, h.cabinet, wines).free }))
        .filter((h) => h.free > 0)
        .sort((a, b) => b.count - a.count || b.free - a.free)[0];
      if (!better) continue;
      moves.push({
        wine,
        from: here.container,
        to: better.container,
        fromLabel: containerLabel(here.container, cabinets, language),
        toLabel: containerLabel(better.container, cabinets, language),
      });
    }
    if (!moves.length) continue;

    const label = containerLabel(here.container, cabinets, language);
    const typeName = getWineTypeLabels(language)[dom.type] || dom.type;
    out.push({
      id: `outlier:${ck}:${dom.type}`,
      kind: "outlier",
      title: t("ui.arrangement.findings.outlierTitle", language, { label, pct: Math.round(dom.share * 100), type: typeName }),
      detail: t(
        intruders.length === 1 ? "ui.arrangement.findings.outlierDetailOne" : "ui.arrangement.findings.outlierDetailMany",
        language,
        { n: intruders.length, type: typeName }
      ),
      wines: intruders,
      moves,
    });
  }
  return out;
}

// Whether a container is a shelf zone at all — used to keep shelf slots out
// of the generic front-to-back "buried" check below, since a shelf board
// slides out on its own rails and doesn't have that kind of blocking.
function isShelfZone(container: Container, cabinets: Cabinet[]): boolean {
  if (container.kind !== "zone") return false;
  const cabinet = cabinets.find((c) => c.id === container.cabinetId);
  return storageRowFor(cabinet, container.zone)?.type === "shelf";
}

// A shelf zone stacks several independent boards, each with its own
// front/back lanes, all sharing one flat depth range (see
// getShelfSlotGroups). Returns null for anything that isn't a shelf zone.
function shelfLevelOf(container: Container, cabinets: Cabinet[], depth: number): number | null {
  if (container.kind !== "zone") return null;
  const cabinet = cabinets.find((c) => c.id === container.cabinetId);
  const sr = cabinet ? storageRowFor(cabinet, container.zone) : undefined;
  if (!sr || sr.type !== "shelf") return null;
  const group = getShelfSlotGroups(sr.shelf_levels).find((g) => depth >= g.start && depth < g.start + g.size);
  return group ? group.level : null;
}

// A bottle whose drinking window is closing, stuck behind or under bottles
// meant to be kept. No move is proposed: freeing it means two bottles trading
// places, and writing that as one-way moves would misdescribe the rack.
//
// Shelf zones are excluded here: the whole board slides out on rails, so its
// front and back lanes are equally reachable — there's no "stuck behind"
// relationship there. A shelf's actual accessibility concern is which
// stacked board a bottle sits on, handled separately by findWrongLevel.
function findBuried(
  placed: { wine: Wine; container: Container }[],
  cabinets: Cabinet[],
  language?: string
): Finding[] {
  const byContainer = new Map<string, { wine: Wine; container: Container }[]>();
  for (const e of placed) {
    const ck = containerKey(e.container);
    const list = byContainer.get(ck);
    if (list) list.push(e);
    else byContainer.set(ck, [e]);
  }

  const out: Finding[] = [];
  for (const entries of byContainer.values()) {
    if (entries.length < 2) continue;
    if (isShelfZone(entries[0].container, cabinets)) continue;
    for (const e of entries) {
      if (!isDrinkSoon(e.wine)) continue;
      const depth = e.wine.depth || 0;
      const inFront = entries.filter((o) => (o.wine.depth || 0) < depth && isKeeper(o.wine));
      if (!inFront.length) continue;
      const label = containerLabel(e.container, cabinets, language);
      const year = drinkByYear(e.wine);
      const name = e.wine.name || t("ui.arrangement.findings.buriedFallbackName", language);
      out.push({
        id: `buried:${e.wine.id}`,
        kind: "buried",
        title: year
          ? t("ui.arrangement.findings.buriedTitleWithYear", language, { name, year })
          : t("ui.arrangement.findings.buriedTitleNoYear", language, { name }),
        detail: t(
          inFront.length === 1 ? "ui.arrangement.findings.buriedDetailOne" : "ui.arrangement.findings.buriedDetailMany",
          language,
          { slot: depth + 1, label, n: inFront.length }
        ),
        wines: [e.wine, ...inFront.map((o) => o.wine)],
        moves: [],
      });
    }
  }
  return out;
}

// A shelf-specific accessibility concern: when an étagère has 2+ stacked
// boards, the lower ones are more work to reach than the higher ones (unlike
// front vs back, which the sliding board makes equally reachable — see
// findBuried above). Flags a bottle due soon sitting on a lower board while
// a bottle marked to keep sits on a higher one in the same étagère.
function findWrongLevel(
  placed: { wine: Wine; container: Container }[],
  cabinets: Cabinet[],
  language?: string
): Finding[] {
  const byContainer = new Map<string, { wine: Wine; container: Container }[]>();
  for (const e of placed) {
    const ck = containerKey(e.container);
    const list = byContainer.get(ck);
    if (list) list.push(e);
    else byContainer.set(ck, [e]);
  }

  const out: Finding[] = [];
  for (const entries of byContainer.values()) {
    const first = entries[0];
    if (!isShelfZone(first.container, cabinets)) continue;
    const cabinet = cabinets.find((c) => c.id === first.container.cabinetId);
    const sr = cabinet ? storageRowFor(cabinet, first.container.zone) : undefined;
    if (!sr || (sr.shelf_levels || []).length < 2) continue;

    for (const e of entries) {
      if (!isDrinkSoon(e.wine)) continue;
      const myLevel = shelfLevelOf(e.container, cabinets, e.wine.depth || 0);
      if (myLevel === null) continue;
      const aboveKeepers = entries.filter((o) => {
        const oLevel = shelfLevelOf(o.container, cabinets, o.wine.depth || 0);
        return oLevel !== null && oLevel > myLevel && isKeeper(o.wine);
      });
      if (!aboveKeepers.length) continue;

      const label = containerLabel(e.container, cabinets, language);
      const year = drinkByYear(e.wine);
      const name = e.wine.name || t("ui.arrangement.findings.buriedFallbackName", language);
      out.push({
        id: `wrongLevel:${e.wine.id}`,
        kind: "buried",
        title: year
          ? t("ui.arrangement.findings.buriedTitleWithYear", language, { name, year })
          : t("ui.arrangement.findings.buriedTitleNoYear", language, { name }),
        detail: t(
          aboveKeepers.length === 1 ? "ui.arrangement.findings.wrongLevelDetailOne" : "ui.arrangement.findings.wrongLevelDetailMany",
          language,
          { label, n: aboveKeepers.length }
        ),
        wines: [e.wine, ...aboveKeepers.map((o) => o.wine)],
        moves: [],
      });
    }
  }
  return out;
}

const KIND_ORDER: FindingKind[] = ["consolidate", "outlier", "buried"];

// Everything the cellar's own arrangement disagrees about, minus what the user
// has waved off for good.
export function analyzeArrangement(
  wines: Wine[],
  cabinets: Cabinet[],
  dismissed: string[] = [],
  language?: string
): Finding[] {
  const live = liveContainers(cabinets);
  const placed = placedWines(wines, live);
  const hidden = new Set(dismissed);
  return [
    ...findScatter(placed, live, cabinets, wines, language),
    ...findOutliers(placed, live, cabinets, wines, language),
    ...findBuried(placed, cabinets, language),
    ...findWrongLevel(placed, cabinets, language),
  ]
    .filter((f) => !hidden.has(f.id))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
