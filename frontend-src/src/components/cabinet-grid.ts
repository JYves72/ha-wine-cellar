import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Cabinet, Wine, StorageRow, WINE_TYPE_COLORS, WineType, getShelfSlotGroups, ShelfSlotGroup } from "../models";
import { sharedStyles } from "../styles";
import { t } from "../i18n";

@customElement("cabinet-grid")
export class CabinetGrid extends LitElement {
  @property({ attribute: false }) hass: any;
  @property({ attribute: false }) cabinet!: Cabinet;
  @property({ attribute: false }) wines: Wine[] = [];
  // Set briefly by "locate" so the bottle is marked on the rack drawing too,
  // not just in the side panel's slot list.
  @property({ attribute: false }) highlightWineId: string | null = null;
  // Candidates for a pending Vivino removal: every listed bottle gets an
  // orange ring so the user can see which ones may be the removed bottle.
  @property({ attribute: false }) removalHighlightIds: string[] = [];

  @state() private _dragOverCell: string | null = null;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .cabinet {
        background: linear-gradient(135deg, #8b6914 0%, #c4973b 50%, #8b6914 100%);
        border-radius: 12px;
        padding: 8px;
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3),
          0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .cabinet-name {
        text-align: center;
        color: #f5e6ca;
        font-size: 0.8em;
        font-weight: 600;
        padding: 4px 0;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      .cabinet-name.clickable {
        cursor: pointer;
        border-radius: 6px;
      }

      .cabinet-name.clickable:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      .grid-inner {
        background: linear-gradient(180deg, #1a1a3a 0%, #0d0d2b 100%);
        border-radius: 8px;
        padding: 6px;
        position: relative;
        overflow: hidden;
      }

      /* Blue LED glow effect */
      .grid-inner::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(
          ellipse at center,
          rgba(50, 100, 255, 0.15) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .row {
        display: flex;
        gap: 2px;
        margin-bottom: 2px;
        position: relative;
      }

      /* Scalloped shelf appearance */
      .row::after {
        content: "";
        position: absolute;
        bottom: -1px;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #6b5010 0%, #a07828 50%, #6b5010 100%);
        border-radius: 0 0 2px 2px;
      }

      .cell {
        flex: 1;
        aspect-ratio: 1;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
        min-width: 0;
        z-index: 1;
        container-type: inline-size;
      }

      .cell.empty {
        background: rgba(255, 255, 255, 0.05);
        border: 1px dashed rgba(255, 255, 255, 0.15);
      }

      .cell.empty:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.3);
      }

      .cell.filled {
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4),
          inset 0 -2px 4px rgba(0, 0, 0, 0.3),
          0 0 8px rgba(50, 100, 255, 0.15);
        border: 2px solid var(--bottle-type-color, rgba(255, 255, 255, 0.1));
        overflow: hidden;
      }

      .cell .wine-thumb,
      .zone-shelf-dot .wine-thumb {
        position: absolute;
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }

      .cell.filled:hover {
        transform: scale(1.15);
        z-index: 10;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5),
          0 0 16px rgba(50, 100, 255, 0.3);
      }

      .cell .bottle-label {
        position: absolute;
        bottom: -14px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 6px;
        color: rgba(255, 255, 255, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 40px;
        display: none;
        pointer-events: none;
      }

      .cell.filled:hover .bottle-label {
        display: block;
      }

      /* "Locate" marker: a pulsing ring drawn outside the element so it
         reads on a filled bottle, an empty slot and a box alike. */
      .locate-highlight {
        position: relative;
        z-index: 3;
        outline: 2px solid rgba(255, 193, 7, 0.9);
        outline-offset: 1px;
        animation: locatePulse 1.2s ease-in-out 3;
        border-radius: inherit;
      }

      @keyframes locatePulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(255, 193, 7, 0);
          outline: 2px solid rgba(255, 193, 7, 0.9);
          outline-offset: 1px;
        }
        50% {
          box-shadow: 0 0 10px 4px rgba(255, 193, 7, 0.65);
          outline: 2px solid rgba(255, 193, 7, 1);
          outline-offset: 2px;
        }
      }

      /* Pending-Vivino-removal candidate: a steady orange ring that pulses
         for as long as the choice is active (unlike the 3-cycle locate). */
      .removal-highlight {
        position: relative;
        z-index: 3;
        outline: 2px solid rgba(255, 109, 0, 0.95);
        outline-offset: 1px;
        animation: removalPulse 1.2s ease-in-out infinite;
        border-radius: inherit;
      }

      @keyframes removalPulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(255, 109, 0, 0);
        }
        50% {
          box-shadow: 0 0 10px 4px rgba(255, 109, 0, 0.65);
        }
      }

      .cell .disposition,
      .zone-shelf-dot .disposition {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 65%;
        height: 65%;
        border-radius: 50%;
        font-size: clamp(7px, 30cqi, 14px);
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        z-index: 2;
        pointer-events: none;
        line-height: 1;
        border: 2px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
      }

      .cell .disposition.drink,
      .zone-bottle .disposition.drink,
      .zone-shelf-dot .disposition.drink {
        background: #2e7d32;
      }

      .cell .disposition.hold,
      .zone-bottle .disposition.hold,
      .zone-shelf-dot .disposition.hold {
        background: #1565c0;
      }

      .cell .disposition.past,
      .zone-bottle .disposition.past,
      .zone-shelf-dot .disposition.past {
        background: #c62828;
      }

      .cell .rating-badge {
        position: absolute;
        bottom: -2px;
        right: -2px;
        font-size: 6px;
        font-weight: 700;
        color: #fff;
        background: rgba(0,0,0,0.6);
        border-radius: 4px;
        padding: 1px 3px;
        z-index: 2;
        pointer-events: none;
        line-height: 1;
        display: none;
      }

      .cell.filled:hover .rating-badge {
        display: block;
      }

      .cell .depth-badge {
        position: absolute;
        top: -2px;
        left: -2px;
        font-size: 7px;
        font-weight: 700;
        color: #fff;
        background: rgba(30, 136, 229, 0.85);
        border-radius: 50%;
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3;
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      }

      .depth-dots {
        position: absolute;
        bottom: 16%;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 3px;
        z-index: 3;
        pointer-events: none;
      }

      .depth-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 255, 255, 0.6);
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
      }

      .depth-dot.empty {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.25);
      }

      .bottom-zone {
        margin-top: 8px;
        background: linear-gradient(135deg, #6b5010 0%, #8b6914 100%);
        border-radius: 6px;
        padding: 8px;
        min-height: 40px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        cursor: pointer;
        position: relative;
        z-index: 1;
      }

      .bottom-zone-label {
        font-size: 0.65em;
        color: rgba(255, 255, 255, 0.6);
        width: 100%;
        text-align: center;
      }

      .zone-bottle {
        position: relative;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 8px;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s;
      }

      .zone-bottle .disposition {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 68%;
        height: 68%;
        border-radius: 50%;
        font-size: 9px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        z-index: 2;
        pointer-events: none;
        line-height: 1;
        border: 1.5px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      }

      .zone-bottle:hover {
        transform: scale(1.1);
      }

      /* Fridge-style shelf: front/back lanes per board. Every dot in the
         shelf shares one size (set inline from the longest lane anywhere
         in it), so a shorter lane is centered with wider gaps instead of
         rendering smaller dots — deliberately not the receding-stagger
         look of a real photographed shelf. Background is dark like the
         classic grid's interior, with each board getting its own
         golden ledge (matching .row::after) instead of the whole zone
         being solid gold. */
      .zone-shelf {
        background: linear-gradient(180deg, #1a1a3a 0%, #0d0d2b 100%);
      }

      .zone-shelf-levels {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        padding: 2px 0;
      }

      .zone-shelf-level {
        display: flex;
        flex-direction: column;
        gap: 2px;
        position: relative;
        padding-bottom: 5px;
      }

      .zone-shelf-level::after {
        content: "";
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #6b5010 0%, #a07828 50%, #6b5010 100%);
        border-radius: 0 0 2px 2px;
      }

      .zone-shelf-lane {
        display: flex;
        justify-content: center;
        gap: 2px;
        width: 100%;
      }

      /* Thinner than the ledge between two boards (.zone-shelf-level::after)
         — this one just separates the front/back lanes of the SAME board,
         it isn't a physical divider. */
      .zone-shelf-lane-divider {
        height: 1px;
        margin: 1px 0;
        background: linear-gradient(90deg, #6b5010 0%, #a07828 50%, #6b5010 100%);
        border-radius: 1px;
      }

      .zone-shelf-lane-label {
        font-size: 0.8em;
        font-weight: 600;
        line-height: 1.2;
        color: #fff;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }

      /* Same empty/filled treatment as a classic grid cell — a faint,
         dashed outline when empty, a solid ring in the wine's colour
         when filled — rather than the paler, always-visible dot this
         used to be. */
      .zone-shelf-dot {
        position: relative;
        flex-shrink: 0;
        aspect-ratio: 1;
        min-width: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.05);
        border: 1px dashed rgba(255, 255, 255, 0.15);
        cursor: pointer;
        overflow: hidden;
        container-type: inline-size;
      }

      .zone-shelf-dot.filled {
        border: 2px solid var(--bottle-type-color, rgba(255, 255, 255, 0.1));
      }

      .zone-shelf-dot[draggable="true"] {
        cursor: grab;
      }

      .zone-shelf-dot[draggable="true"]:active {
        cursor: grabbing;
      }

      .zone-shelf-dot.drag-over {
        box-shadow: 0 0 0 2px rgba(66, 165, 245, 0.8);
        transform: scale(1.15);
      }

      /* Drag and drop */
      .cell.drag-source {
        opacity: 0.35;
        transform: scale(0.9);
      }

      .cell.drag-over {
        box-shadow: 0 0 0 3px rgba(66, 165, 245, 0.8);
        transform: scale(1.1);
        background: rgba(66, 165, 245, 0.15) !important;
        z-index: 10;
      }

      .cell[draggable="true"] {
        cursor: grab;
      }

      .cell[draggable="true"]:active {
        cursor: grabbing;
      }

      .zone-bottle.drag-over {
        box-shadow: 0 0 0 2px rgba(66, 165, 245, 0.8);
        transform: scale(1.15);
      }

      .bottom-zone.drag-over {
        box-shadow: inset 0 0 0 2px rgba(66, 165, 245, 0.8);
        background: rgba(66, 165, 245, 0.1);
      }

      .zone-count {
        font-weight: 400;
        opacity: 0.7;
        margin-left: 4px;
      }

      .zone-fill-dots {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }

      .zone-fill-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 255, 255, 0.4);
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
      }

      .zone-fill-dot.empty {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.2);
      }

      .zone-box-row {
        cursor: pointer;
        padding: 4px 8px;
        min-height: 0;
        flex-direction: column;
        align-items: center;
      }

      .zone-box-row:hover {
        background: linear-gradient(135deg, #7a5a12 0%, #9a7820 100%);
      }

      .zone-box-grid {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        justify-content: center;
        padding: 2px 0;
        width: 100%;
      }

      .zone-box-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
      }

      .zone-box-shape {
        width: 56px;
        height: 36px;
        position: relative;
      }

      .zone-box-shape .box-lid {
        position: absolute;
        top: 0;
        left: -2px;
        right: -2px;
        height: 28%;
        background: linear-gradient(180deg, #a08040 0%, #7a6020 100%);
        border-radius: 2px 2px 0 0;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-bottom: none;
      }

      .zone-box-shape .box-body {
        position: absolute;
        top: 28%;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(180deg, #8b6914 0%, #6b5010 100%);
        border-radius: 0 0 2px 2px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-top: 1px solid rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .zone-box-shape .box-count {
        font-size: 0.7em;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.5);
        line-height: 1;
      }

      .zone-box-item.has-wine .box-count {
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      /* Phone: tighter spacing, smaller elements */
      @media (max-width: 599px) {
        .cabinet {
          padding: 6px;
          border-radius: 10px;
        }
        .cabinet-name {
          font-size: 0.75em;
          padding: 3px 0;
        }
        .grid-inner {
          padding: 4px;
        }
        .row {
          gap: 1px;
          margin-bottom: 1px;
        }
        .row::after {
          height: 2px;
        }
        .cell .bottle-label {
          font-size: 5px;
          max-width: 30px;
        }
        .bottom-zone {
          margin-top: 6px;
          padding: 6px;
          gap: 4px;
          min-height: 32px;
        }
        .bottom-zone-label {
          font-size: 0.6em;
        }
        .zone-bottle {
          width: 22px;
          height: 22px;
          font-size: 7px;
        }
      }

      /* Tablet: moderate sizing */
      @media (min-width: 600px) and (max-width: 1023px) {
        .cabinet {
          padding: 6px;
        }
        .grid-inner {
          padding: 5px;
        }
        .row {
          gap: 2px;
          margin-bottom: 1px;
        }
      }
    `,
  ];

  // Shorthand for t(key, this.hass?.language, params) — see wine-cellar-card.ts.
  private _t(key: string, params?: Record<string, string | number>): string {
    return t(key, this.hass?.language, params);
  }

  private _getWinesAt(row: number, col: number): Wine[] {
    return this.wines.filter(
      (w) =>
        w.cabinet_id === this.cabinet.id && w.row === row && w.col === col
    );
  }

  private _getStorageRowSet(): Set<number> {
    const rows = (this.cabinet as any).storage_rows as StorageRow[] | undefined;
    return new Set((rows || []).map((sr) => sr.row));
  }

  private _getStorageRowConfig(row: number): StorageRow | undefined {
    const rows = (this.cabinet as any).storage_rows as StorageRow[] | undefined;
    return (rows || []).find((s) => s.row === row);
  }

  private _getStorageRowName(row: number): string {
    return this._getStorageRowConfig(row)?.name || this._t("wineLocation.storage");
  }

  private _getBottomZoneWines(): Wine[] {
    return this.wines.filter(
      (w) => w.cabinet_id === this.cabinet.id && w.zone === "bottom"
    );
  }

  private _getStorageRowWines(row: number): Wine[] {
    return this.wines
      .filter((w) => w.cabinet_id === this.cabinet.id && w.zone === `storage-${row}`)
      .sort((a, b) => (a.depth || 0) - (b.depth || 0));
  }

  private _onCellClick(row: number, col: number, wine?: Wine, wineCount = 0, cabinetDepth = 1, wines: Wine[] = []) {
    this.dispatchEvent(
      new CustomEvent("cell-click", {
        detail: {
          cabinet: this.cabinet,
          row,
          col,
          wine,
          wines,
          wineCount,
          cabinetDepth,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onZoneClick(wine?: Wine, zone = "bottom", depth?: number) {
    this.dispatchEvent(
      new CustomEvent("zone-click", {
        detail: {
          cabinet: this.cabinet,
          zone,
          wine,
          // Set only for zones with per-slot addressing (shelf): the exact
          // slot clicked, so the card places/pastes there instead of
          // picking a depth itself.
          depth,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onZoneContainerClick(zone: string, storageRow: StorageRow) {
    this.dispatchEvent(
      new CustomEvent("zone-container-click", {
        detail: {
          cabinet: this.cabinet,
          zone,
          storageRow,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _brightenColor(hex: string): string {
    // Make wine type colors brighter for the ring border
    const brightMap: Record<string, string> = {
      "#722F37": "#c44d58",  // red → brighter red
      "#F5E6CA": "#fff8e8",  // white → bright cream
      "#E8A0BF": "#f5c0d8",  // rosé → brighter pink
      "#D4E09B": "#e8f0b8",  // sparkling → brighter green
      "#DAA520": "#f0c040",  // dessert → brighter gold
      "#B5651D": "#d9843a",  // whisky → brighter amber
    };
    return brightMap[hex] || hex;
  }

  // --- Long press (mobile move) ---

  private _longPressTimer: number | null = null;

  private _onTouchStart(wine: Wine) {
    this._longPressTimer = window.setTimeout(() => {
      this._longPressTimer = null;
      this.dispatchEvent(new CustomEvent("wine-longpress", {
        detail: { wine, cabinet: this.cabinet },
        bubbles: true,
        composed: true,
      }));
    }, 500);
  }

  private _onTouchEnd() {
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  private _onTouchMove() {
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  // --- Drag and drop ---

  private _onDragStart(e: DragEvent, wine: Wine, row?: number, col?: number, zone?: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({
      wineId: wine.id,
      cabinetId: this.cabinet.id,
      row: row ?? null,
      col: col ?? null,
      zone: zone || "",
      depth: wine.depth ?? null,
    }));
    e.dataTransfer.effectAllowed = "move";
    (e.currentTarget as HTMLElement).classList.add("drag-source");
  }

  private _onDragEnd(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("drag-source");
    this._dragOverCell = null;
  }

  private _onDragOver(e: DragEvent, key: string) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    this._dragOverCell = key;
  }

  private _onDragLeave(_e: DragEvent) {
    this._dragOverCell = null;
  }

  private _onDrop(e: DragEvent, targetRow?: number, targetCol?: number, targetZone?: string, targetWine?: Wine, explicitDepth?: number) {
    e.preventDefault();
    this._dragOverCell = null;
    if (!e.dataTransfer) return;
    try {
      const source = JSON.parse(e.dataTransfer.getData("text/plain"));

      // Slot zones (shelf) pass their own exact depth — the drop target
      // IS the slot, so skip the "nearest chip" reorder heuristic used
      // for freeform bulk-zone drops and let the card swap/place exactly
      // there instead of picking a depth itself.
      if (explicitDepth !== undefined) {
        this.dispatchEvent(new CustomEvent("wine-drop", {
          detail: {
            wineId: source.wineId,
            sourceCabinetId: source.cabinetId,
            sourceRow: source.row,
            sourceCol: source.col,
            sourceZone: source.zone,
            sourceDepth: source.depth ?? null,
            targetCabinetId: this.cabinet.id,
            targetRow: null,
            targetCol: null,
            targetZone: targetZone || "",
            targetWineId: targetWine?.id ?? null,
            targetDepth: explicitDepth,
            explicitDepth: true,
          },
          bubbles: true,
          composed: true,
        }));
        return;
      }

      // Bulk-zone reordering: figure out which bottle the drop landed
      // nearest to (and which half of it), so dropping anywhere in the zone
      // reorders sensibly instead of only working when the cursor lands
      // exactly on a chip — small chips are hard to hit precisely.
      let effectiveTargetWine = targetWine;
      let insertBefore = true;
      if (effectiveTargetWine) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        insertBefore = e.clientX < rect.left + rect.width / 2;
      } else if (targetZone) {
        const container = e.currentTarget as HTMLElement;
        const chips = Array.from(container.querySelectorAll<HTMLElement>(".zone-bottle"));
        let nearest: HTMLElement | null = null;
        let nearestDist = Infinity;
        for (const chip of chips) {
          if (chip.dataset.wineId === source.wineId) continue;
          const rect = chip.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const dist = Math.abs(e.clientX - cx);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = chip;
          }
        }
        if (nearest) {
          const rect = nearest.getBoundingClientRect();
          insertBefore = e.clientX < rect.left + rect.width / 2;
          effectiveTargetWine = this.wines.find((w) => w.id === nearest!.dataset.wineId);
        }
      }

      this.dispatchEvent(new CustomEvent("wine-drop", {
        detail: {
          wineId: source.wineId,
          sourceCabinetId: source.cabinetId,
          sourceRow: source.row,
          sourceCol: source.col,
          sourceZone: source.zone,
          targetCabinetId: this.cabinet.id,
          targetRow: targetRow ?? null,
          targetCol: targetCol ?? null,
          targetZone: targetZone || "",
          // When dropping on/near another bottle within the same bulk
          // zone, carry its id + which side the drop landed on, so the
          // card can insert relative to it instead of treating it as a
          // same-zone no-op.
          targetWineId: effectiveTargetWine?.id ?? null,
          targetDepth: effectiveTargetWine ? (effectiveTargetWine.depth ?? 0) : null,
          insertBefore,
        },
        bubbles: true,
        composed: true,
      }));
    } catch { /* ignore bad data */ }
  }

  private _renderStorageZone(row: number) {
    const sr = this._getStorageRowConfig(row);
    // No generic "Storage" filler when unnamed — the icon and count already
    // say what this is; an unnamed zone just shows those two.
    const zoneName = sr?.name || "";
    const zoneType = sr?.type || "bulk";
    const capacity = sr?.capacity || 20;
    const zoneId = `storage-${row}`;
    const wines = this._getStorageRowWines(row);
    const zoneKey = `zone-${zoneId}`;
    const isDragOver = this._dragOverCell === zoneKey;

    if (zoneType === "box") {
      return this._renderBoxZone(zoneId, zoneKey, zoneName, capacity, wines, isDragOver, sr!);
    }
    if (zoneType === "shelf") {
      return this._renderShelfZone(zoneId, zoneKey, zoneName, capacity, wines, isDragOver, sr!);
    }
    // Default: bulk
    return this._renderBulkZone(zoneId, zoneKey, zoneName, capacity, wines, isDragOver, sr!);
  }

  private _renderBulkZone(zoneId: string, zoneKey: string, name: string, capacity: number, wines: Wine[], isDragOver: boolean, sr: StorageRow) {
    return html`
      <div class="bottom-zone ${isDragOver ? "drag-over" : ""}"
        @click=${() => sr ? this._onZoneContainerClick(zoneId, sr) : this._onZoneClick(undefined, zoneId)}
        @dragover=${(e: DragEvent) => this._onDragOver(e, zoneKey)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
        @drop=${(e: DragEvent) => this._onDrop(e, undefined, undefined, zoneId)}>
        ${name ? html`<div class="bottom-zone-label">${name}</div>` : nothing}
        ${wines.map((wine) => {
          const disp = wine.disposition || "";
          const dispClass = disp === "D" ? "drink" : disp === "H" ? "hold" : disp === "P" ? "past" : "";
          const bottleKey = `${zoneKey}-${wine.id}`;
          return html`
            <div
              class="zone-bottle ${this._dragOverCell === bottleKey ? "drag-over" : ""} ${wine.id === this.highlightWineId ? "locate-highlight" : ""} ${this.removalHighlightIds.includes(wine.id) ? "removal-highlight" : ""}"
              style="background: ${WINE_TYPE_COLORS[wine.type as WineType] || WINE_TYPE_COLORS.red}"
              data-wine-id="${wine.id}"
              draggable="true"
              @click=${(e: Event) => {
                e.stopPropagation();
                this._onZoneClick(wine, zoneId);
              }}
              @dragstart=${(e: DragEvent) => { e.stopPropagation(); this._onDragStart(e, wine, undefined, undefined, zoneId); }}
              @dragend=${(e: DragEvent) => this._onDragEnd(e)}
              @dragover=${(e: DragEvent) => { e.stopPropagation(); this._onDragOver(e, bottleKey); }}
              @dragleave=${(e: DragEvent) => { e.stopPropagation(); this._onDragLeave(e); }}
              @drop=${(e: DragEvent) => { e.stopPropagation(); this._onDrop(e, undefined, undefined, zoneId, wine); }}
              @touchstart=${(e: TouchEvent) => { e.stopPropagation(); this._onTouchStart(wine); }}
              @touchend=${() => this._onTouchEnd()}
              @touchmove=${() => this._onTouchMove()}
              title="${wine.name} (${wine.vintage || "NV"})"
            >
              ${(wine.vintage || "NV").toString().slice(-2)}
              ${dispClass ? html`<span class="disposition ${dispClass}">${disp}</span>` : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderBoxZone(zoneId: string, zoneKey: string, name: string, capacity: number, wines: Wine[], isDragOver: boolean, sr: StorageRow) {
    const boxes = sr.boxes || [capacity];
    let offset = 0;
    const boxSegments = boxes.map((boxSize) => {
      const start = offset;
      offset += boxSize;
      const boxWines = wines.filter((w) => {
        const d = w.depth || 0;
        return d >= start && d < start + boxSize;
      });
      return {
        size: boxSize,
        start,
        wineCount: boxWines.length,
        hasHighlight:
          !!this.highlightWineId && boxWines.some((w) => w.id === this.highlightWineId),
        hasRemoval:
          this.removalHighlightIds.length > 0 &&
          boxWines.some((w) => this.removalHighlightIds.includes(w.id)),
      };
    });

    return html`
      <div class="bottom-zone zone-box-row ${isDragOver ? "drag-over" : ""}"
        @click=${() => this._onZoneContainerClick(zoneId, sr)}
        @dragover=${(e: DragEvent) => this._onDragOver(e, zoneKey)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
        @drop=${(e: DragEvent) => this._onDrop(e, undefined, undefined, zoneId)}>
        ${name ? html`<div class="bottom-zone-label">${name}</div>` : nothing}
        <div class="zone-box-grid">
          ${boxSegments.map((seg) => html`
            <div class="zone-box-item ${seg.wineCount > 0 ? "has-wine" : ""} ${seg.hasHighlight ? "locate-highlight" : ""} ${seg.hasRemoval ? "removal-highlight" : ""}">
              <div class="zone-box-shape">
                <div class="box-lid"></div>
                <div class="box-body"><span class="box-count">${seg.wineCount}/${seg.size}</span></div>
              </div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  // Fridge-style shelf: one or more physical boards stacked bottom-to-top,
  // each with its own front and back lane. Every slot has a fixed physical
  // position (unlike a bulk/box pile), so — like a classic grid cell —
  // each dot is its own click/drag/drop target: click an empty one to add
  // there, click an occupied one to open it, drop exactly on the dot you
  // choose. There is no zone side panel for shelves.
  private _renderShelfZone(zoneId: string, zoneKey: string, name: string, capacity: number, wines: Wine[], isDragOver: boolean, sr: StorageRow) {
    const levelsData = sr.shelf_levels || [];
    const groups = getShelfSlotGroups(levelsData);
    const byLevel = new Map<number, { front?: ShelfSlotGroup; back?: ShelfSlotGroup }>();
    for (const g of groups) {
      const entry = byLevel.get(g.level) || {};
      entry[g.lane] = g;
      byLevel.set(g.level, entry);
    }
    // Level 0 is the bottom board (see models.ts) — reverse for display,
    // since flex-direction: column lays out children top-to-bottom.
    const levels = Array.from(byLevel.entries()).sort((a, b) => b[0] - a[0]);

    // One dot size for the whole shelf, sized off whichever lane is
    // longest anywhere in it — so a 3-bottle back row doesn't render
    // bigger dots than a 4-bottle front row. The shorter lane just ends
    // up centered with more gap, the way a real shelf looks, rather than
    // the receding stagger of a photo (the user explicitly didn't want
    // that reproduced here).
    const maxCount = Math.max(1, ...levelsData.map((l) => Math.max(l.front, l.back)));
    const dotBasis = `${100 / maxCount}%`;

    const renderDots = (group: ShelfSlotGroup) => html`
      <div class="zone-shelf-lane ${group.lane}">
        ${Array.from({ length: group.size }, (_, i) => {
          const depth = group.start + i;
          const dotKey = `${zoneKey}-${depth}`;
          const wine = wines.find((w) => (w.depth || 0) === depth);
          const bg = wine ? WINE_TYPE_COLORS[wine.type as WineType] || WINE_TYPE_COLORS.red : "";
          const ring = wine ? this._brightenColor(bg) : "";
          const disp = wine?.disposition || "";
          const dispClass = disp === "D" ? "drink" : disp === "H" ? "hold" : disp === "P" ? "past" : "";
          return html`<span
            class="zone-shelf-dot ${wine ? "filled" : ""} ${this._dragOverCell === dotKey ? "drag-over" : ""} ${wine && wine.id === this.highlightWineId ? "locate-highlight" : ""} ${wine && this.removalHighlightIds.includes(wine.id) ? "removal-highlight" : ""}"
            style="flex-basis:${dotBasis};max-width:${dotBasis}${wine ? `;background:${bg};--bottle-type-color:${ring}` : ""}"
            title="${wine ? `${wine.name} (${wine.vintage || "NV"})` : ""}"
            draggable=${wine ? "true" : "false"}
            @click=${(e: Event) => { e.stopPropagation(); this._onZoneClick(wine, zoneId, depth); }}
            @dragstart=${wine ? (e: DragEvent) => { e.stopPropagation(); this._onDragStart(e, wine, undefined, undefined, zoneId); } : nothing}
            @dragend=${(e: DragEvent) => this._onDragEnd(e)}
            @dragover=${(e: DragEvent) => { e.stopPropagation(); this._onDragOver(e, dotKey); }}
            @dragleave=${(e: DragEvent) => { e.stopPropagation(); this._onDragLeave(e); }}
            @drop=${(e: DragEvent) => { e.stopPropagation(); this._onDrop(e, undefined, undefined, zoneId, wine, depth); }}
            @touchstart=${wine ? (e: TouchEvent) => { e.stopPropagation(); this._onTouchStart(wine); } : nothing}
            @touchend=${() => this._onTouchEnd()}
            @touchmove=${() => this._onTouchMove()}
          >${wine?.image_url ? html`<img class="wine-thumb" src="${wine.image_url}" alt="" />` : nothing}${dispClass ? html`<span class="disposition ${dispClass}">${disp}</span>` : nothing}</span>`;
        })}
      </div>
    `;

    // Back lane's label sits above its dots, front lane's below — so each
    // board reads top-to-bottom as "Back / [dots] / [dots] / Front",
    // making it clear both rows belong to the same physical board.
    const renderBack = (group: ShelfSlotGroup | undefined) => {
      if (!group) return nothing;
      return html`
        <div class="zone-shelf-lane-label">${this._t("ui.card.shelfBack")}</div>
        ${renderDots(group)}
      `;
    };
    const renderFront = (group: ShelfSlotGroup | undefined) => {
      if (!group) return nothing;
      return html`
        ${renderDots(group)}
        <div class="zone-shelf-lane-label">${this._t("ui.card.shelfFront")}</div>
      `;
    };

    return html`
      <div class="bottom-zone zone-shelf">
        ${name ? html`<div class="bottom-zone-label">${name}</div>` : nothing}
        <div class="zone-shelf-levels">
          ${levels.map(([, lanes]) => html`
            <div class="zone-shelf-level">
              ${renderBack(lanes.back)}
              ${lanes.back && lanes.front ? html`<div class="zone-shelf-lane-divider"></div>` : nothing}
              ${renderFront(lanes.front)}
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderGridRow(row: number, cols: number) {
    const cabinetDepth = (this.cabinet as any).depth || 1;
    return html`
      <div class="row">
        ${Array.from({ length: cols }, (_, col) => {
          const wines = this._getWinesAt(row, col);
          const wineCount = wines.length;
          const frontWine = wines.length > 0
            ? wines.sort((a, b) => (a.depth || 0) - (b.depth || 0))[0]
            : undefined;
          const bgColor = frontWine
            ? WINE_TYPE_COLORS[frontWine.type as WineType] || WINE_TYPE_COLORS.red
            : "transparent";
          const disp = frontWine?.disposition || "";
          const dispClass = disp === "D" ? "drink" : disp === "H" ? "hold" : disp === "P" ? "past" : "";
          const ratingDisplay = frontWine?.rating ? frontWine.rating.toFixed(1) : "";
          const ringColor = frontWine ? this._brightenColor(bgColor) : "";
          const cellKey = `${row}-${col}`;
          const isDragOver = this._dragOverCell === cellKey;
          const isHighlighted =
            !!this.highlightWineId && wines.some((w) => w.id === this.highlightWineId);
          const isRemovalCandidate =
            this.removalHighlightIds.length > 0 &&
            wines.some((w) => this.removalHighlightIds.includes(w.id));
          return html`
            <div
              class="cell ${frontWine ? "filled" : "empty"} ${isDragOver ? "drag-over" : ""} ${isHighlighted ? "locate-highlight" : ""} ${isRemovalCandidate ? "removal-highlight" : ""}"
              style=${frontWine ? `background: ${bgColor}; --bottle-type-color: ${ringColor}` : ""}
              draggable=${frontWine ? "true" : "false"}
              @click=${() => this._onCellClick(row, col, frontWine, wineCount, cabinetDepth, wines)}
              @touchstart=${frontWine ? () => this._onTouchStart(frontWine) : nothing}
              @touchend=${frontWine ? () => this._onTouchEnd() : nothing}
              @touchmove=${frontWine ? () => this._onTouchMove() : nothing}
              @dragstart=${frontWine ? (e: DragEvent) => this._onDragStart(e, frontWine, row, col) : nothing}
              @dragend=${frontWine ? (e: DragEvent) => this._onDragEnd(e) : nothing}
              @dragover=${(e: DragEvent) => this._onDragOver(e, cellKey)}
              @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
              @drop=${(e: DragEvent) => this._onDrop(e, row, col)}
              title=${frontWine
                ? `${frontWine.name} (${frontWine.vintage || "NV"})${frontWine.rating ? ` ★${frontWine.rating}` : ""}${wineCount > 1 ? ` [${wineCount}/${cabinetDepth} deep]` : ""}`
                : this._t("ui.card.emptyCellTitle", { row: row + 1, col: col + 1 })}
            >
              ${frontWine
                ? html`
                    ${frontWine.image_url ? html`<img class="wine-thumb" src="${frontWine.image_url}" alt="" />` : nothing}
                    <span class="bottle-label">${frontWine.vintage || "NV"}</span>
                    ${dispClass ? html`<span class="disposition ${dispClass}">${disp}</span>` : nothing}
                    ${ratingDisplay ? html`<span class="rating-badge">★${ratingDisplay}</span>` : nothing}
                    ${wineCount > 1 ? html`<span class="depth-badge">${wineCount}</span>` : nothing}
                    ${cabinetDepth >= 2
                      ? html`
                          <span class="depth-dots">
                            ${Array.from({ length: cabinetDepth }, (_, d) => {
                              const wineAtDepth = wines.find((w) => (w.depth || 0) === d);
                              const dotColor = wineAtDepth
                                ? WINE_TYPE_COLORS[wineAtDepth.type as WineType] || WINE_TYPE_COLORS.red
                                : "";
                              return html`<span
                                class="depth-dot ${wineAtDepth ? "" : "empty"}"
                                style=${wineAtDepth ? `background: ${dotColor}` : ""}
                              ></span>`;
                            })}
                          </span>
                        `
                      : nothing}
                  `
                : cabinetDepth >= 2 && wineCount === 0
                  ? html`
                      <span class="depth-dots">
                        ${Array.from({ length: cabinetDepth }, () =>
                          html`<span class="depth-dot empty"></span>`
                        )}
                      </span>
                    `
                  : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderCell(row: number, col: number) {
    const cabinetDepth = (this.cabinet as any).depth || 1;
    const wines = this._getWinesAt(row, col);
    const wineCount = wines.length;
    const frontWine = wines.length > 0
      ? wines.sort((a, b) => (a.depth || 0) - (b.depth || 0))[0]
      : undefined;
    const bgColor = frontWine
      ? WINE_TYPE_COLORS[frontWine.type as WineType] || WINE_TYPE_COLORS.red
      : "transparent";
    const disp = frontWine?.disposition || "";
    const dispClass = disp === "D" ? "drink" : disp === "H" ? "hold" : disp === "P" ? "past" : "";
    const ratingDisplay = frontWine?.rating ? frontWine.rating.toFixed(1) : "";
    const ringColor = frontWine ? this._brightenColor(bgColor) : "";
    const cellKey = `${row}-${col}`;
    const isDragOver = this._dragOverCell === cellKey;
    return html`
      <div
        class="cell ${frontWine ? "filled" : "empty"} ${isDragOver ? "drag-over" : ""}"
        style=${frontWine ? `background: ${bgColor}; --bottle-type-color: ${ringColor}` : ""}
        draggable=${frontWine ? "true" : "false"}
        @click=${() => this._onCellClick(row, col, frontWine, wineCount, cabinetDepth, wines)}
        @touchstart=${frontWine ? () => this._onTouchStart(frontWine) : nothing}
        @touchend=${frontWine ? () => this._onTouchEnd() : nothing}
        @touchmove=${frontWine ? () => this._onTouchMove() : nothing}
        @dragstart=${frontWine ? (e: DragEvent) => this._onDragStart(e, frontWine, row, col) : nothing}
        @dragend=${frontWine ? (e: DragEvent) => this._onDragEnd(e) : nothing}
        @dragover=${(e: DragEvent) => this._onDragOver(e, cellKey)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
        @drop=${(e: DragEvent) => this._onDrop(e, row, col)}
        title=${frontWine
          ? `${frontWine.name} (${frontWine.vintage || "NV"})${frontWine.rating ? ` ★${frontWine.rating}` : ""}${wineCount > 1 ? ` [${wineCount}/${cabinetDepth} deep]` : ""}`
          : this._t("ui.card.emptyCellTitle", { row: row + 1, col: col + 1 })}
      >
        ${frontWine
          ? html`
              ${frontWine.image_url ? html`<img class="wine-thumb" src="${frontWine.image_url}" alt="" />` : nothing}
              <span class="bottle-label">${frontWine.vintage || "NV"}</span>
              ${dispClass ? html`<span class="disposition ${dispClass}">${disp}</span>` : nothing}
              ${ratingDisplay ? html`<span class="rating-badge">★${ratingDisplay}</span>` : nothing}
              ${wineCount > 1 ? html`<span class="depth-badge">${wineCount}</span>` : nothing}
              ${cabinetDepth >= 2
                ? html`
                    <span class="depth-dots">
                      ${Array.from({ length: cabinetDepth }, (_, d) => {
                        const wineAtDepth = wines.find((w) => (w.depth || 0) === d);
                        const dotColor = wineAtDepth
                          ? WINE_TYPE_COLORS[wineAtDepth.type as WineType] || WINE_TYPE_COLORS.red
                          : "";
                        return html`<span
                          class="depth-dot ${wineAtDepth ? "" : "empty"}"
                          style=${wineAtDepth ? `background: ${dotColor}` : ""}
                        ></span>`;
                      })}
                    </span>
                  `
                : nothing}
            `
          : cabinetDepth >= 2 && wineCount === 0
            ? html`
                <span class="depth-dots">
                  ${Array.from({ length: cabinetDepth }, () =>
                    html`<span class="depth-dot empty"></span>`
                  )}
                </span>
              `
            : nothing}
      </div>
    `;
  }

  private _onRackClick() {
    this.dispatchEvent(
      new CustomEvent("rack-click", {
        detail: { cabinet: this.cabinet },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const { rows, cols } = this.cabinet;
    const storageRows = this._getStorageRowSet();
    const hasGridRows = Array.from({ length: rows }, (_, row) => row).some((row) => !storageRows.has(row));

    return html`
      <div class="cabinet">
        <div
          class="cabinet-name ${hasGridRows ? "clickable" : ""}"
          @click=${hasGridRows ? () => this._onRackClick() : nothing}
          title=${hasGridRows ? this._t("ui.card.reorderRackTitle") : ""}
        >${this.cabinet.name}</div>
        <div class="grid-inner">
          ${Array.from({ length: rows }, (_, row) =>
              storageRows.has(row)
                ? this._renderStorageZone(row)
                : this._renderGridRow(row, cols)
            )
          }
        </div>
        ${this.cabinet.has_bottom_zone
          ? html`
              <div class="bottom-zone ${this._dragOverCell === "zone-bottom" ? "drag-over" : ""}"
                @click=${() => this._onZoneClick()}
                @dragover=${(e: DragEvent) => this._onDragOver(e, "zone-bottom")}
                @dragleave=${(e: DragEvent) => this._onDragLeave(e)}
                @drop=${(e: DragEvent) => this._onDrop(e, undefined, undefined, "bottom")}>
                <div class="bottom-zone-label">
                  ${this.cabinet.bottom_zone_name}
                </div>
                ${this._getBottomZoneWines().map(
                  (wine) => html`
                    <div
                      class="zone-bottle"
                      style="background: ${WINE_TYPE_COLORS[wine.type as WineType] || WINE_TYPE_COLORS.red}"
                      draggable="true"
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._onZoneClick(wine);
                      }}
                      @dragstart=${(e: DragEvent) => { e.stopPropagation(); this._onDragStart(e, wine, undefined, undefined, "bottom"); }}
                      @dragend=${(e: DragEvent) => this._onDragEnd(e)}
                      title="${wine.name}"
                    >
                      ${(wine.vintage || "NV").toString().slice(-2)}
                    </div>
                  `
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
