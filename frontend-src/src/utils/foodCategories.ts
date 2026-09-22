import { normalizeText } from "./search";

// Groups the AI's free-form, highly specific food-pairing suggestions
// ("daube de bœuf", "bœuf bourguignon", "carbonnade flamande"...) into a
// small set of generic categories for the "Accords avec" filter, so the
// dropdown doesn't balloon into dozens of near-synonyms and near-duplicates
// (plural/singular, "grillé"/"grillée"/"grillés" agreement, etc). The wine
// detail view still shows the AI's original text unchanged — categorization
// only affects this filter facet.
//
// Categories are French-language, matching the free-text pairings this
// cellar's AI currently generates (metadata_language "fr"). If metadata
// language is ever switched, these category labels would need their own
// per-language variants — not done here since the data itself isn't
// generated in another language for this cellar.
//
// Checked in order, most specific (named protein/ingredient) before generic
// cooking-style buckets ("Grillades", "Plats mijotés"), so a dish that names
// its protein lands under that protein rather than the generic bucket.
interface FoodCategory {
  label: string;
  keywords: string[];
}

const OTHER_LABEL = "Autres accords";

const FOOD_CATEGORIES: FoodCategory[] = [
  {
    label: "Apéritif & tapas",
    keywords: ["aperitif", "tapas", "gougere", "amuse-bouche", "amuse bouche"],
  },
  {
    label: "Charcuterie",
    keywords: ["charcuterie", "rillette", "saucisson", "jambon", "pate", "terrine", "salami", "chorizo"],
  },
  {
    label: "Fromages",
    keywords: ["fromage", "roquefort", "comte", "chevre", "brie", "camembert", "munster", "reblochon", "morbier", "parmesan"],
  },
  {
    label: "Fruits de mer",
    keywords: ["fruits de mer", "huitre", "crevette", "homard", "crustace", "coquille", "moule", "langouste", "crabe", "sushi", "sashimi"],
  },
  {
    label: "Poissons",
    keywords: ["poisson", "saumon", "cabillaud", "sole", "brochet", "truite", "papillote", "thon", "dorade", "morue", "bar"],
  },
  {
    label: "Canard & foie gras",
    keywords: ["canard", "magret", "foie gras"],
  },
  {
    label: "Volaille",
    keywords: ["volaille", "poulet", "poularde", "dinde", "pintade", "chapon"],
  },
  {
    label: "Agneau",
    keywords: ["agneau", "gigot"],
  },
  {
    label: "Gibier",
    keywords: ["gibier", "cerf", "chevreuil", "sanglier", "biche", "faisan", "perdrix", "lievre"],
  },
  {
    label: "Bœuf & viandes rouges",
    keywords: ["boeuf", "entrecote", "steak", "tournedos", "viande rouge", "viandes rouges", "cote de boeuf"],
  },
  {
    label: "Plats mijotés & en sauce",
    keywords: ["daube", "bourguignon", "carbonnade", "civet", "cassoulet", "mijote", "en sauce", "ragout", "pot-au-feu", "blanquette", "estouffade"],
  },
  {
    label: "Grillades & barbecue",
    keywords: ["grillade", "grille", "barbecue", "brochette"],
  },
  {
    label: "Cuisine épicée & du monde",
    keywords: ["curry", "epice", "asiatique", "wok", "tex-mex", "mexicain", "indien", "thai", "szechuan"],
  },
  {
    label: "Cuisine méditerranéenne",
    keywords: ["~mediterran", "~provenc", "ratatouille", "tajine"],
  },
  {
    label: "Salades",
    keywords: ["salade"],
  },
  {
    label: "Plats végétariens",
    keywords: ["risotto", "legume", "~vegetarien", "asperge", "champignon", "quiche"],
  },
  {
    label: "Desserts",
    keywords: ["dessert", "chocolat", "tarte", "patisserie", "gateau", "glace", "sorbet", "fruit"],
  },
];

// Two matching modes per keyword:
// - default: word-boundary match allowing an optional French "e"/"s"/"es"
//   suffix (singular/plural + masc/fem agreement) without an open wildcard,
//   so short stems don't swallow unrelated words ("bar" must not match
//   "barbecue", "chevre" must not match "chevreuil", "brochet" must not
//   match "brochette").
// - "~"-prefixed: open wildcard suffix, reserved for longer stems with
//   irregular agreement (méditerranéen/-enne/-ens/-ennes) that are long
//   enough to carry no collision risk.
// - multi-word phrases (contain a space or hyphen): plain substring match,
//   already specific enough on their own.
function matchesKeyword(haystack: string, keyword: string): boolean {
  if (keyword.includes(" ") || keyword.includes("-")) {
    return haystack.includes(keyword);
  }
  if (keyword.startsWith("~")) {
    return new RegExp(`\\b${keyword.slice(1)}\\w*\\b`).test(haystack);
  }
  return new RegExp(`\\b${keyword}(?:e?s?)\\b`).test(haystack);
}

// Maps one split pairing ("daube de bœuf") to its generic category label
// ("Plats mijotés & en sauce"). Falls back to a shared "Autres accords"
// bucket when nothing matches, rather than showing the raw specific text —
// keeping the filter list short is the whole point of this function.
export function categorizeFoodPairing(pairing: string): string {
  const haystack = normalizeText(pairing);
  if (!haystack) return OTHER_LABEL;
  for (const category of FOOD_CATEGORIES) {
    if (category.keywords.some((kw) => matchesKeyword(haystack, kw))) {
      return category.label;
    }
  }
  return OTHER_LABEL;
}
