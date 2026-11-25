import { normalizeText } from "./search";

// Groups the AI's free-form, highly specific food-pairing suggestions
// ("daube de bœuf", "bœuf bourguignon", "carbonnade flamande"...) into a
// small set of generic categories for the "Accords avec" filter, so the
// dropdown doesn't balloon into dozens of near-synonyms and near-duplicates
// (plural/singular, "grillé"/"grillée"/"grillés" agreement, etc). The wine
// detail view still shows the AI's original text unchanged — categorization
// only affects this filter facet.
//
// Categories exist for French and English, picked from the Vivino/AI
// language. In any other language the pairing is listed as written.
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
    label: "Foie gras",
    keywords: ["foie gras"],
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
    label: "Canard",
    keywords: ["canard", "magret"],
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

const ENGLISH_CATEGORIES: FoodCategory[] = [
  {
    label: "Aperitif & snacks",
    keywords: ["aperitif", "appetizer", "appetiser", "tapas", "canape", "nibbles"],
  },
  {
    label: "Foie gras",
    keywords: ["foie gras"],
  },
  {
    label: "Charcuterie",
    keywords: ["charcuterie", "ham", "salami", "chorizo", "sausage", "prosciutto", "pate", "terrine", "rillette", "cold cuts", "cured meat"],
  },
  {
    label: "Cheese",
    keywords: ["cheese", "roquefort", "comte", "brie", "camembert", "parmesan", "cheddar", "gouda", "gruyere", "manchego"],
  },
  {
    label: "Seafood",
    keywords: ["seafood", "shellfish", "oyster", "shrimp", "prawn", "lobster", "crab", "mussel", "clam", "scallop", "sushi", "sashimi", "calamari"],
  },
  {
    label: "Fish",
    keywords: ["fish", "salmon", "cod", "sole", "trout", "tuna", "bream", "bass", "halibut", "monkfish"],
  },
  {
    label: "Duck",
    keywords: ["duck"],
  },
  {
    label: "Poultry",
    keywords: ["poultry", "chicken", "turkey", "capon", "quail", "guinea fowl"],
  },
  {
    label: "Lamb",
    keywords: ["lamb", "mutton"],
  },
  {
    label: "Game",
    keywords: ["game", "venison", "deer", "boar", "pheasant", "partridge", "hare", "rabbit"],
  },
  {
    label: "Pork & veal",
    keywords: ["pork", "veal"],
  },
  {
    label: "Beef & red meat",
    keywords: ["beef", "steak", "entrecote", "ribeye", "sirloin", "burger", "hamburger", "red meat"],
  },
  {
    label: "Stews & braised dishes",
    keywords: ["stew", "braised", "casserole", "ragout", "daube", "bourguignon", "cassoulet", "goulash", "in sauce", "pot roast"],
  },
  {
    label: "Grills & barbecue",
    keywords: ["grill", "grilled", "barbecue", "bbq", "kebab", "skewer", "roast", "roasted"],
  },
  {
    label: "Spicy & world cuisine",
    keywords: ["curry", "curries", "spicy", "spiced", "asian", "wok", "tex-mex", "mexican", "indian", "thai", "szechuan", "chinese"],
  },
  {
    label: "Pasta & pizza",
    keywords: ["pasta", "pizza", "lasagna", "lasagne", "spaghetti", "gnocchi"],
  },
  {
    label: "Mediterranean cuisine",
    keywords: ["~mediterran", "~provenc", "ratatouille", "tagine", "tajine"],
  },
  {
    label: "Salads",
    keywords: ["salad"],
  },
  {
    label: "Vegetarian dishes",
    keywords: ["risotto", "vegetable", "~vegetarian", "asparagus", "mushroom", "quiche"],
  },
  {
    label: "Desserts",
    keywords: ["dessert", "chocolate", "tart", "pastry", "pastries", "cake", "cheesecake", "fruit", "berry", "berries", "strawberry", "strawberries", "raspberry", "raspberries", "sorbet", "ice cream"],
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

const CATEGORY_SETS: Record<string, { categories: FoodCategory[]; other: string }> = {
  fr: { categories: FOOD_CATEGORIES, other: OTHER_LABEL },
  en: { categories: ENGLISH_CATEGORIES, other: "Other pairings" },
};

// Maps one split pairing ("daube de bœuf") to its generic category label
// ("Plats mijotés & en sauce"). Falls back to a shared "other" bucket when
// nothing matches, rather than showing the raw specific text — keeping the
// filter list short is the whole point of this function.
export function categorizeFoodPairing(pairing: string, language: string): string {
  const set = CATEGORY_SETS[language];
  if (!set) {
    const text = pairing.trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const haystack = normalizeText(pairing);
  if (!haystack) return set.other;
  for (const category of set.categories) {
    if (category.keywords.some((kw) => matchesKeyword(haystack, kw))) {
      return category.label;
    }
  }
  return set.other;
}
