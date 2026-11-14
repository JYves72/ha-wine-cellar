# What each action does

A short reference for what Cork Dork calls, and when. Nothing is sent to the AI unless you ask for it.

## Adding a wine

| How you add it | What runs | What you get |
|---|---|---|
| **Barcode** (scan or typed) | Vivino barcode lookup only. No AI. | Name, winery, vintage, rating, photo, Vivino link, and Vivino's drinking window. Run "Analyze with AI" yourself to fill the rest. |
| **Label photo** | AI reads the label, then a Vivino lookup runs as soon as the wine is recognised. | AI fields (name, winery, region, grapes, notes…) plus the Vivino link, rating and drinking window when a trustworthy match is found. |
| **Search by name** | Vivino text search only. No AI. | A list to pick from. Only results containing at least half of the words you typed are shown; if nothing fits, the list is empty and you can use manual entry. |
| **Manual entry** | Nothing. | Exactly what you typed. |

## After adding

| Action | What runs | Notes |
|---|---|---|
| **Refresh from Vivino** (wine sheet, or batch) | Vivino lookup by id when the wine is already linked, otherwise text search with a relevance check. | Updates rating, photo, grapes, description, and the drinking window. Never changes a locked price. |
| **Link Vivino manually** | Reads the Vivino page you paste. | The link becomes permanent: never searched again, and shared with identical bottles. |
| **Wrong wine** ("Ce n'est pas le bon vin") | Cuts the Vivino tie. | The page is remembered and never proposed again. |
| **Analyze with AI** (single or batch) | One AI call per distinct wine (identical bottles share the result). | Fills description, food pairings, serving temperature, drinking and peak windows. |

## Where the dates come from

- **Drinking window and "drink by"**: Vivino's own recommendation for that vintage, when the wine is linked. This replaces any earlier value.
- **Peak window**: an AI estimate based on the type of wine, not specific to the vintage. It is kept inside Vivino's window and runs to its end.
- Without a Vivino link, both come from the AI, taking the rack temperature and time in the rack into account.
