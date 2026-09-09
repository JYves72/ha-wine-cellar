import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Cabinet, Wine, StorageRow, getStorageRowTypeLabels, BOX_SIZES } from "../models";
import { sharedStyles } from "../styles";
import { t } from "../i18n";

type Mode = "list" | "add" | "edit" | "delete-confirm";

@customElement("rack-settings-dialog")
export class RackSettingsDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) hass: any;
  @property({ attribute: false }) cabinets: Cabinet[] = [];
  @property({ attribute: false }) wines: Wine[] = [];

  @state() private _mode: Mode = "list";
  @state() private _editCabinet: Partial<Cabinet> = {};
  @state() private _editStorageRows: StorageRow[] = [];
  // A rack is exactly one of these four — chosen once, right under the
  // name, rather than picked per row. "grid" has no storage rows at all;
  // the other three are a single concept (a list of shelves, one bulk
  // bin, or one set of boxes) with nothing to mix in. Inferred from the
  // data when editing; an explicit choice when adding, since there is no
  // data yet to infer from.
  @state() private _cabinetStyle: "grid" | "shelf" | "bulk" | "box" = "grid";
  @state() private _deleteCabinet: Cabinet | null = null;
  @state() private _loading = false;
  @state() private _error = "";

  static styles = [
    sharedStyles,
    css`
      .rack-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .rack-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--wc-border);
        border-radius: 10px;
        transition: background 0.2s;
      }

      .rack-item:hover {
        background: var(--wc-hover);
      }

      .rack-info {
        flex: 1;
        min-width: 0;
      }

      .rack-name {
        font-weight: 600;
        font-size: 0.95em;
      }

      .rack-meta {
        font-size: 0.8em;
        color: var(--wc-text-secondary);
        margin-top: 2px;
      }

      .rack-actions {
        display: flex;
        gap: 4px;
        align-items: center;
        flex-shrink: 0;
      }

      .small-btn {
        background: transparent;
        border: 1px solid var(--wc-border);
        border-radius: 6px;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 0.8em;
        color: var(--wc-text-secondary);
        transition: all 0.2s;
      }

      .small-btn:hover {
        background: var(--wc-hover);
      }

      .small-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }

      .small-btn.danger {
        color: #c62828;
        border-color: rgba(198, 40, 40, 0.3);
      }

      .small-btn.danger:hover {
        background: rgba(198, 40, 40, 0.08);
      }

      .warning-msg {
        background: rgba(255, 152, 0, 0.1);
        border: 1px solid rgba(255, 152, 0, 0.3);
        border-radius: 8px;
        padding: 10px;
        font-size: 0.85em;
        color: #e65100;
        margin-top: 12px;
      }

      .warning-list {
        margin-top: 6px;
        padding-left: 10px;
        font-size: 0.95em;
        opacity: 0.85;
      }

      .delete-info {
        font-size: 0.95em;
        margin: 12px 0;
        line-height: 1.5;
      }

      .delete-count {
        color: #c62828;
        font-weight: 600;
      }

      .style-toggle {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .style-toggle-btn {
        flex: 1 1 45%;
        padding: 8px 10px;
        border: 1px solid var(--wc-border);
        border-radius: 8px;
        background: transparent;
        color: var(--wc-text-secondary);
        cursor: pointer;
        font-size: 0.85em;
        transition: all 0.15s;
      }

      .style-toggle-btn.active {
        border-color: var(--wc-primary);
        color: var(--wc-primary);
        background: rgba(114, 47, 55, 0.08);
        font-weight: 600;
      }

      .add-rack-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px;
        border: 2px dashed var(--wc-border);
        border-radius: 10px;
        background: transparent;
        color: var(--wc-text-secondary);
        cursor: pointer;
        font-size: 0.9em;
        transition: all 0.2s;
        width: 100%;
      }

      .add-rack-btn:hover {
        border-color: var(--wc-primary);
        color: var(--wc-primary);
        background: rgba(114, 47, 55, 0.05);
      }

      /* Grid editor */
      .grid-editor {
        margin-top: 12px;
      }

      .grid-editor-title {
        font-size: 0.85em;
        font-weight: 600;
        color: var(--wc-text);
        margin-bottom: 12px;
      }

      /* Stepper controls for cols/depth */
      .stepper-row {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;
      }

      .stepper {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0;
        border: 1px solid var(--wc-border);
        border-radius: 8px;
        overflow: hidden;
      }

      .stepper-label {
        font-size: 0.75em;
        color: var(--wc-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
        font-weight: 500;
      }

      .stepper-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .stepper-btn {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 1.1em;
        font-weight: 600;
        color: var(--wc-text-secondary);
        transition: all 0.15s;
        flex-shrink: 0;
      }

      .stepper-btn:hover:not(:disabled) {
        background: rgba(114, 47, 55, 0.1);
        color: var(--wc-primary);
      }

      .stepper-btn:disabled {
        opacity: 0.25;
        cursor: default;
      }

      .stepper-value {
        flex: 1;
        text-align: center;
        font-size: 0.9em;
        font-weight: 600;
        color: var(--wc-text);
        padding: 6px 0;
        min-width: 40px;
      }

      /* Visual grid preview */
      .grid-preview {
        border: 1px solid var(--wc-border);
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        overflow-x: auto;
      }

      .grid-preview-row {
        display: flex;
        gap: 3px;
        margin-bottom: 3px;
        align-items: center;
      }

      .grid-preview-row:last-child {
        margin-bottom: 0;
      }

      .grid-preview-label {
        width: 28px;
        font-size: 0.65em;
        font-weight: 600;
        color: var(--wc-text-secondary);
        text-align: center;
        flex-shrink: 0;
      }

      .grid-preview-cell {
        width: 20px;
        height: 16px;
        border-radius: 3px;
        background: rgba(114, 47, 55, 0.15);
        border: 1px solid rgba(114, 47, 55, 0.25);
        flex-shrink: 0;
      }

      .grid-preview-row.storage .grid-preview-cell {
        background: rgba(139, 105, 20, 0.15);
        border-color: rgba(139, 105, 20, 0.3);
      }

      .grid-preview-storage-label {
        font-size: 0.6em;
        color: #8b6914;
        font-weight: 600;
        white-space: nowrap;
        padding-left: 4px;
      }

      .grid-preview-row.storage .grid-preview-cell {
        width: unset;
        flex: 1;
        max-width: none;
      }

      /* Row list */
      .row-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--wc-border);
        border-radius: 8px;
        padding: 6px;
      }

      .row-entry {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 6px;
        font-size: 0.8em;
        transition: background 0.15s;
      }

      .row-entry:hover {
        background: var(--wc-hover);
      }

      .row-entry.storage {
        background: rgba(139, 105, 20, 0.1);
        border: 1px solid rgba(139, 105, 20, 0.3);
      }

      .row-entry .row-num {
        width: 28px;
        font-weight: 600;
        color: var(--wc-text-secondary);
        font-size: 0.85em;
      }

      .row-type-select {
        padding: 2px 4px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        font-size: 0.8em;
        background: var(--wc-bg);
        color: var(--wc-text);
        cursor: pointer;
      }

      .row-name-input {
        width: 80px;
        padding: 2px 6px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        font-size: 0.8em;
        background: var(--wc-bg);
        color: var(--wc-text);
        flex-shrink: 1;
        min-width: 60px;
      }

      .row-cap-select {
        padding: 2px 4px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        font-size: 0.8em;
        background: var(--wc-bg);
        color: var(--wc-text);
        cursor: pointer;
      }

      .row-shelf-input {
        width: 32px;
        padding: 2px 4px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        font-size: 0.8em;
        background: var(--wc-bg);
        color: var(--wc-text);
        text-align: center;
      }

      .row-cap-stepper {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .stepper-btn-sm {
        width: 20px;
        height: 20px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        background: var(--wc-bg);
        color: var(--wc-text);
        cursor: pointer;
        font-size: 0.8em;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .stepper-btn-sm:hover {
        background: var(--wc-hover);
      }

      .stepper-val-sm {
        font-size: 0.8em;
        font-weight: 600;
        min-width: 22px;
        text-align: center;
      }

      .row-type-info {
        flex: 1;
        font-size: 0.8em;
        color: var(--wc-text-secondary);
      }

      .row-entry input[type="text"] {
        width: 100px;
        padding: 2px 6px;
        border: 1px solid var(--wc-border);
        border-radius: 4px;
        font-size: 0.85em;
        background: var(--wc-bg);
        color: var(--wc-text);
      }

      .row-controls {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }

      .row-ctrl-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 0;
        border: 1px dashed var(--wc-border);
        border-radius: 6px;
        background: transparent;
        color: var(--wc-text-secondary);
        cursor: pointer;
        font-size: 0.8em;
        transition: all 0.15s;
      }

      .row-ctrl-btn:hover:not(:disabled) {
        border-color: var(--wc-primary);
        color: var(--wc-primary);
        background: rgba(114, 47, 55, 0.05);
      }

      .row-ctrl-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }

      .row-ctrl-btn.danger:hover:not(:disabled) {
        border-color: #c62828;
        color: #c62828;
        background: rgba(198, 40, 40, 0.05);
      }
    `,
  ];

  // Shorthand for t(key, this.hass?.language, params) — see wine-cellar-card.ts.
  private _t(key: string, params?: Record<string, string | number>): string {
    return t(key, this.hass?.language, params);
  }

  updated(changedProps: Map<string, unknown>) {
    if (changedProps.has("open") && this.open) {
      this._mode = "list";
      this._error = "";
    }
  }

  private _close() {
    this._mode = "list";
    this._error = "";
    this.dispatchEvent(new CustomEvent("close"));
  }

  private _notifyUpdate() {
    this.dispatchEvent(
      new CustomEvent("racks-updated", { bubbles: true, composed: true })
    );
  }

  private _winesInCabinet(cabinetId: string): number {
    return this.wines.filter((w) => w.cabinet_id === cabinetId).length;
  }

  // The single shelf/bulk/box row(s) actually belonging to the active
  // style — switching styles while exploring keeps the others' config
  // around in _editStorageRows (harmless: only the active style's rows
  // are ever rendered or saved) so flipping back doesn't lose work.
  private _shelfRows(): StorageRow[] {
    return this._editStorageRows.filter((sr) => sr.type === "shelf");
  }

  private _bulkRow(): StorageRow | undefined {
    return this._editStorageRows.find((sr) => sr.type === "bulk");
  }

  private _boxRow(): StorageRow | undefined {
    return this._editStorageRows.find((sr) => sr.type === "box");
  }

  // What actually gets saved, freshly computed from the active style —
  // never a stale mix of whatever _editStorageRows happens to be holding
  // from earlier style exploration. Shelf rows are always renumbered
  // 0..N-1 in list order; the physical row a bottle sits behind never
  // survives a shelf being removed anyway (see _displacedWines).
  private _finalStorageRows(): StorageRow[] {
    if (this._cabinetStyle === "shelf") {
      return this._shelfRows().map((sr, i) => ({ ...sr, row: i }));
    }
    if (this._cabinetStyle === "bulk") {
      const sr = this._bulkRow();
      return sr ? [{ ...sr, row: 0 }] : [];
    }
    if (this._cabinetStyle === "box") {
      const sr = this._boxRow();
      return sr ? [{ ...sr, row: 0 }] : [];
    }
    return [];
  }

  private _finalRows(): number {
    if (this._cabinetStyle === "grid") return this._editCabinet.rows || 1;
    if (this._cabinetStyle === "shelf") return Math.max(1, this._shelfRows().length);
    return 1;
  }

  private _finalCols(): number {
    return this._cabinetStyle === "grid" ? this._editCabinet.cols || 8 : 1;
  }

  private _finalDepth(): number {
    return this._cabinetStyle === "grid" ? (this._editCabinet as any).depth || 1 : 1;
  }

  private static _capacityOf(sr: StorageRow): number {
    if (sr.type === "box") return (sr.boxes || []).reduce((sum, b) => sum + b, 0);
    if (sr.type === "shelf") {
      return (sr.shelf_levels || []).reduce((sum, lvl) => sum + lvl.front + lvl.back, 0);
    }
    return sr.capacity || 0;
  }

  // Every bottle the pending edit would leave without a slot that exists.
  //
  // The warning and the save both read this, so what the user is promised
  // and what actually happens cannot drift apart. It used to consider only
  // rows and columns, which meant three ways of losing a bottle's position
  // went unwarned and unhandled: making a rack shallower, shrinking a bin
  // past its contents, and deleting a bin outright. None of them ever
  // deleted a bottle — they left it pointing at a slot the rack no longer
  // had, counted in the total and drawn nowhere.
  private _displacedWines(): Wine[] {
    const cabinetId = this._editCabinet.id;
    if (!cabinetId) return [];
    const newRows = this._finalRows();
    const newCols = this._finalCols();
    const newDepth = this._finalDepth();
    const rows = this._finalStorageRows();

    return this.wines.filter((w) => {
      if (w.cabinet_id !== cabinetId) return false;
      if (w.zone) {
        const sr = rows.find((s) => `storage-${s.row}` === w.zone);
        if (!sr) return true;
        return (w.depth || 0) >= RackSettingsDialog._capacityOf(sr);
      }
      if (w.row == null || w.col == null) return false;
      if (w.row >= newRows || w.col >= newCols) return true;
      if ((w.depth || 0) >= newDepth) return true;
      return rows.some((sr) => sr.row === w.row);
    });
  }

  private _startAdd() {
    this._mode = "add";
    this._error = "";
    this._editCabinet = {
      name: "",
      rows: 1,
      cols: 8,
      depth: 1,
      has_bottom_zone: false,
      bottom_zone_name: "",
    };
    this._editStorageRows = [];
    this._cabinetStyle = "grid";
  }

  private _startEdit(cabinet: Cabinet) {
    this._mode = "edit";
    this._error = "";
    this._editCabinet = { ...cabinet };
    // Initialize storage rows from cabinet data, ensuring boxes/levels exist
    this._editStorageRows = (cabinet.storage_rows || []).map((sr) => {
      if (sr.type === "box" && !sr.boxes) {
        return { ...sr, boxes: [sr.capacity || 12] };
      }
      if (sr.type === "shelf" && !sr.shelf_levels) {
        return { ...sr, shelf_levels: [{ front: sr.capacity || 4, back: 0 }] };
      }
      return { ...sr };
    });
    const types = new Set(this._editStorageRows.map((sr) => sr.type));
    if (types.size === 0) {
      this._cabinetStyle = "grid";
    } else if (types.has("shelf") && this._editStorageRows.length === (cabinet.rows || 0)) {
      this._cabinetStyle = "shelf";
    } else if (types.has("bulk") && this._editStorageRows.length === 1) {
      this._cabinetStyle = "bulk";
    } else if (types.has("box") && this._editStorageRows.length === 1) {
      this._cabinetStyle = "box";
    } else {
      // Doesn't cleanly match one of the four styles (e.g. an older mixed
      // rack) — fall back to showing it as a classic grid rather than
      // guessing; its storage rows stay in _editStorageRows either way and
      // are only dropped if the user actually saves from this fallback.
      this._cabinetStyle = "grid";
    }
  }

  private static _buildAlternatingLevels(
    front: number, back: number, count: number
  ): { front: number; back: number }[] {
    const f = Math.max(0, front);
    const b = Math.max(0, back);
    return Array.from({ length: Math.max(1, count) }, (_, i) =>
      i % 2 === 0 ? { front: f, back: b } : { front: b, back: f }
    );
  }

  // Front/back are shared by every shelf in the rack; how many rows each
  // shelf has is that shelf's own choice (a fridge shelf can be one board
  // or two stacked ones) — read the shared pair from the first shelf,
  // since _applySharedFrontBack keeps it in lockstep across all of them.
  private _sharedShelfFrontBack(): { front: number; back: number } {
    const lvl0 = this._shelfRows()[0]?.shelf_levels?.[0];
    return { front: lvl0?.front ?? 4, back: lvl0?.back ?? 0 };
  }

  // Re-derives every shelf's levels from a new shared front/back, keeping
  // each shelf's own level count exactly as it was.
  private _applySharedFrontBack(front: number, back: number) {
    const f = Math.max(0, front);
    const b = Math.max(0, back);
    this._editStorageRows = this._editStorageRows.map((sr) => {
      if (sr.type !== "shelf") return sr;
      const levels = RackSettingsDialog._buildAlternatingLevels(f, b, sr.shelf_levels?.length || 1);
      const capacity = levels.reduce((sum, l) => sum + l.front + l.back, 0);
      return { ...sr, shelf_levels: levels, capacity };
    });
  }

  private _setSharedFront(value: number) {
    this._applySharedFrontBack(value, this._sharedShelfFrontBack().back);
  }

  private _setSharedBack(value: number) {
    this._applySharedFrontBack(this._sharedShelfFrontBack().front, value);
  }

  // Changes just this one shelf's row count, using the shared front/back.
  private _setShelfLevelCountAt(index: number, count: number) {
    count = Math.max(1, Math.min(6, count));
    const { front, back } = this._sharedShelfFrontBack();
    const rows = this._shelfRows();
    if (!rows[index]) return;
    const levels = RackSettingsDialog._buildAlternatingLevels(front, back, count);
    const capacity = levels.reduce((sum, l) => sum + l.front + l.back, 0);
    rows[index] = { ...rows[index], shelf_levels: levels, capacity };
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "shelf"), ...rows];
  }

  // Rebuilds the shelf list to the requested count, applying the shared
  // front/back to any new ones (starting at 1 row each — a second row is
  // an explicit per-shelf choice, not assumed) and keeping existing
  // shelves' own name and row count (by position) rather than resetting
  // them.
  private _setShelfCount(count: number) {
    count = Math.max(1, Math.min(20, count));
    const { front, back } = this._sharedShelfFrontBack();
    const existing = this._shelfRows();
    const rows: StorageRow[] = Array.from({ length: count }, (_, i) => {
      const prior = existing[i];
      const levels = RackSettingsDialog._buildAlternatingLevels(front, back, prior?.shelf_levels?.length || 1);
      const capacity = levels.reduce((sum, l) => sum + l.front + l.back, 0);
      return { row: i, name: prior?.name || "", type: "shelf", capacity, shelf_levels: levels };
    });
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "shelf"), ...rows];
  }

  private _updateShelfName(index: number, name: string) {
    const rows = this._shelfRows().map((sr, i) => (i === index ? { ...sr, name } : sr));
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "shelf"), ...rows];
  }

  private _setBulkCapacity(capacity: number) {
    capacity = Math.max(1, Math.min(500, capacity));
    const row: StorageRow = { row: 0, name: this._bulkRow()?.name || "", type: "bulk", capacity };
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "bulk"), row];
  }

  private _updateBoxCount(count: number) {
    const existing = this._boxRow();
    const boxes = [...(existing?.boxes || [12])];
    while (boxes.length < count) boxes.push(12);
    while (boxes.length > count) boxes.pop();
    const capacity = boxes.reduce((sum, s) => sum + s, 0);
    const row: StorageRow = { row: 0, name: existing?.name || "", type: "box", capacity, boxes };
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "box"), row];
  }

  private _updateBoxSize(boxIndex: number, size: number) {
    const existing = this._boxRow();
    const boxes = [...(existing?.boxes || [12])];
    boxes[boxIndex] = size;
    const capacity = boxes.reduce((sum, s) => sum + s, 0);
    const row: StorageRow = { row: 0, name: existing?.name || "", type: "box", capacity, boxes };
    this._editStorageRows = [...this._editStorageRows.filter((sr) => sr.type !== "box"), row];
  }

  // Switching style lazily creates that style's default config the first
  // time it's chosen; any other style's config already built this session
  // is left alone in _editStorageRows so flipping back doesn't lose it —
  // only the active style's rows are ever rendered or saved.
  private _setCabinetStyle(style: "grid" | "shelf" | "bulk" | "box") {
    this._cabinetStyle = style;
    if (style === "shelf" && this._shelfRows().length === 0) {
      this._setShelfCount(1);
    } else if (style === "bulk" && !this._bulkRow()) {
      this._setBulkCapacity(20);
    } else if (style === "box" && !this._boxRow()) {
      this._updateBoxCount(1);
    }
  }

  private _startDelete(cabinet: Cabinet) {
    this._mode = "delete-confirm";
    this._error = "";
    this._deleteCabinet = cabinet;
  }

  // Grid style only — no storage rows ever mix into a classic grid rack,
  // so there is nothing to reconcile here beyond the row count itself.
  private _addRow() {
    const current = this._editCabinet.rows || 1;
    if (current >= 20) return;
    this._editCabinet = { ...this._editCabinet, rows: current + 1 };
  }

  private _removeRow() {
    const current = this._editCabinet.rows || 1;
    if (current <= 1) return;
    this._editCabinet = { ...this._editCabinet, rows: current - 1 };
  }

  private _addCol() {
    const current = this._editCabinet.cols || 1;
    if (current >= 20) return;
    this._editCabinet = { ...this._editCabinet, cols: current + 1 };
  }

  private _removeCol() {
    const current = this._editCabinet.cols || 1;
    if (current <= 1) return;
    this._editCabinet = { ...this._editCabinet, cols: current - 1 };
  }

  private _addDepth() {
    const current = (this._editCabinet as any).depth || 1;
    if (current >= 6) return;
    this._editCabinet = { ...this._editCabinet, depth: current + 1 };
  }

  private _removeDepth() {
    const current = (this._editCabinet as any).depth || 1;
    if (current <= 1) return;
    this._editCabinet = { ...this._editCabinet, depth: current - 1 };
  }

  private async _saveAdd() {
    this._loading = true;
    this._error = "";
    try {
      await this.hass.callWS({
        type: "wine_cellar/add_cabinet",
        cabinet: {
          name: this._editCabinet.name || "New Rack",
          rows: this._finalRows(),
          cols: this._finalCols(),
          depth: this._finalDepth(),
          has_bottom_zone: false,
          bottom_zone_name: "",
          storage_rows: this._finalStorageRows(),
          order: this.cabinets.length,
          orientation: "vertical",
        },
      });
      this._notifyUpdate();
      this._mode = "list";
    } catch {
      this._error = this._t("ui.rack.failedToAddRack");
    }
    this._loading = false;
  }

  private async _saveEdit() {
    this._loading = true;
    this._error = "";
    try {
      const cabinetId = this._editCabinet.id!;

      // Worked out before the rack changes shape: afterwards the old slot
      // is unrecoverable, and this is the same list the warning showed.
      const displaced = this._displacedWines();

      await this.hass.callWS({
        type: "wine_cellar/update_cabinet",
        cabinet_id: cabinetId,
        updates: {
          name: this._editCabinet.name,
          rows: this._finalRows(),
          cols: this._finalCols(),
          depth: this._finalDepth(),
          has_bottom_zone: false,
          bottom_zone_name: "",
          storage_rows: this._finalStorageRows(),
          orientation: "vertical",
        },
      });

      for (const wine of displaced) {
        await this.hass.callWS({
          type: "wine_cellar/update_wine",
          wine_id: wine.id,
          updates: { cabinet_id: "", row: null, col: null, zone: "", depth: 0 },
        });
      }

      this._notifyUpdate();
      this._mode = "list";
    } catch {
      this._error = this._t("ui.rack.failedToUpdateRack");
    }
    this._loading = false;
  }

  private async _confirmDelete() {
    if (!this._deleteCabinet) return;
    this._loading = true;
    this._error = "";
    try {
      await this.hass.callWS({
        type: "wine_cellar/remove_cabinet",
        cabinet_id: this._deleteCabinet.id,
      });
      this._notifyUpdate();
      this._mode = "list";
      this._deleteCabinet = null;
    } catch {
      this._error = this._t("ui.rack.failedToDeleteRack");
    }
    this._loading = false;
  }

  private async _moveUp(cabinet: Cabinet) {
    const sorted = [...this.cabinets].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === cabinet.id);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    try {
      await Promise.all([
        this.hass.callWS({
          type: "wine_cellar/update_cabinet",
          cabinet_id: cabinet.id,
          updates: { order: prev.order },
        }),
        this.hass.callWS({
          type: "wine_cellar/update_cabinet",
          cabinet_id: prev.id,
          updates: { order: cabinet.order },
        }),
      ]);
      this._notifyUpdate();
    } catch {
      this._error = this._t("ui.rack.failedToReorderRacks");
    }
  }

  private async _moveDown(cabinet: Cabinet) {
    const sorted = [...this.cabinets].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === cabinet.id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const next = sorted[idx + 1];
    try {
      await Promise.all([
        this.hass.callWS({
          type: "wine_cellar/update_cabinet",
          cabinet_id: cabinet.id,
          updates: { order: next.order },
        }),
        this.hass.callWS({
          type: "wine_cellar/update_cabinet",
          cabinet_id: next.id,
          updates: { order: cabinet.order },
        }),
      ]);
      this._notifyUpdate();
    } catch {
      this._error = this._t("ui.rack.failedToReorderRacks");
    }
  }

  private _renderList() {
    const sorted = [...this.cabinets].sort((a, b) => a.order - b.order);
    return html`
      <div class="dialog-body">
        <div class="rack-list">
          ${sorted.map(
            (cab, idx) => {
              const storageCount = (cab.storage_rows || []).length;
              const isPureStorage = storageCount > 0 && storageCount === (cab.rows || 0);
              return html`
                <div class="rack-item">
                  <div class="rack-info">
                    <div class="rack-name">${cab.name}</div>
                    <div class="rack-meta">
                      ${isPureStorage ? nothing : html`${this._t("ui.rack.gridDimensions", { rows: cab.rows, cols: cab.cols })}${(cab.depth || 1) > 1 ? this._t("ui.rack.gridDeepSuffix", { depth: cab.depth }) : ""}`}
                      ${this._t("ui.rack.bottlesCountSuffix", { n: this._winesInCabinet(cab.id), plural: this._winesInCabinet(cab.id) === 1 ? "" : "s" })}
                      ${storageCount > 0 ? this._t("ui.rack.storageCountSuffix", { n: storageCount, plural: storageCount === 1 ? "" : "s" }) : ""}
                    </div>
                  </div>
                  <div class="rack-actions">
                    <button
                      class="small-btn"
                      @click=${() => this._moveUp(cab)}
                      ?disabled=${idx === 0}
                      title="${this._t('ui.rack.moveUpTitle')}"
                    >↑</button>
                    <button
                      class="small-btn"
                      @click=${() => this._moveDown(cab)}
                      ?disabled=${idx === sorted.length - 1}
                      title="${this._t('ui.rack.moveDownTitle')}"
                    >↓</button>
                    <button
                      class="small-btn"
                      @click=${() => this._startEdit(cab)}
                    >${this._t("ui.common.edit")}</button>
                    <button
                      class="small-btn danger"
                      @click=${() => this._startDelete(cab)}
                    >${this._t("ui.rack.delBtn")}</button>
                  </div>
                </div>
              `;
            }
          )}

          <button class="add-rack-btn" @click=${this._startAdd}>
            ${this._t("ui.rack.addRackBtn")}
          </button>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-outline" @click=${this._close}>${this._t("ui.common.close")}</button>
      </div>
    `;
  }

  private _renderStyleForm() {
    const numRows = this._editCabinet.rows || 1;
    const numCols = this._editCabinet.cols || 8;
    const numDepth = (this._editCabinet as any).depth || 1;

    if (this._cabinetStyle === "grid") {
      return html`
        <div class="grid-editor-title">${this._t("ui.rack.gridLayoutTitle")}</div>
        <div class="stepper-row">
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.rowsLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${this._removeRow} ?disabled=${numRows <= 1}>−</button>
              <span class="stepper-value">${numRows}</span>
              <button class="stepper-btn" @click=${this._addRow} ?disabled=${numRows >= 20}>+</button>
            </div>
          </div>
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.columnsLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${this._removeCol} ?disabled=${numCols <= 1}>−</button>
              <span class="stepper-value">${numCols}</span>
              <button class="stepper-btn" @click=${this._addCol} ?disabled=${numCols >= 20}>+</button>
            </div>
          </div>
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.depthLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${this._removeDepth} ?disabled=${numDepth <= 1}>−</button>
              <span class="stepper-value">${numDepth}</span>
              <button class="stepper-btn" @click=${this._addDepth} ?disabled=${numDepth >= 6}>+</button>
            </div>
          </div>
        </div>

        <!-- Visual grid preview -->
        <div class="grid-preview">
          ${Array.from({ length: numRows }, (_, row) => html`
            <div class="grid-preview-row">
              <span class="grid-preview-label">R${row + 1}</span>
              ${Array.from({ length: Math.min(numCols, 15) }, () => html`<div class="grid-preview-cell"></div>`)}
              ${numCols > 15
                ? html`<span style="font-size:0.65em;color:var(--wc-text-secondary)">+${numCols - 15}</span>`
                : nothing}
            </div>
          `)}
        </div>
      `;
    }

    if (this._cabinetStyle === "shelf") {
      const shared = this._sharedShelfFrontBack();
      const shelves = this._shelfRows();
      return html`
        <div class="stepper-row">
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.shelfCountLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${() => this._setShelfCount(shelves.length - 1)} ?disabled=${shelves.length <= 1}>−</button>
              <span class="stepper-value">${shelves.length}</span>
              <button class="stepper-btn" @click=${() => this._setShelfCount(shelves.length + 1)} ?disabled=${shelves.length >= 20}>+</button>
            </div>
          </div>
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.shelfFrontLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${() => this._setSharedFront(shared.front - 1)} ?disabled=${shared.front <= 0}>−</button>
              <span class="stepper-value">${shared.front}</span>
              <button class="stepper-btn" @click=${() => this._setSharedFront(shared.front + 1)} ?disabled=${shared.front >= 30}>+</button>
            </div>
          </div>
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.shelfBackLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${() => this._setSharedBack(shared.back - 1)} ?disabled=${shared.back <= 0}>−</button>
              <span class="stepper-value">${shared.back}</span>
              <button class="stepper-btn" @click=${() => this._setSharedBack(shared.back + 1)} ?disabled=${shared.back >= 30}>+</button>
            </div>
          </div>
        </div>
        <p style="font-size:0.75em;color:var(--wc-text-secondary);margin:0 0 8px">${this._t("ui.rack.shelfAlternateHint")}</p>

        <!-- Name + row count per shelf — front/back are shared above,
             but how many boards each shelf has is its own choice. -->
        <div class="row-list">
          ${shelves.map((sr, i) => {
            const levelCount = sr.shelf_levels?.length || 1;
            return html`
              <div class="row-entry storage">
                <span class="row-num">${i + 1}</span>
                <input
                  type="text"
                  class="row-name-input"
                  style="flex:1"
                  .value=${sr.name || ""}
                  @input=${(e: InputEvent) => this._updateShelfName(i, (e.target as HTMLInputElement).value)}
                  placeholder="${this._t('ui.rack.shelfNamePlaceholder', { n: i + 1 })}"
                />
                <span class="row-type-info" style="flex:0;font-size:0.7em">${this._t('ui.rack.shelfLevelsLabel')}</span>
                <div class="row-cap-stepper">
                  <button class="stepper-btn-sm" @click=${() => this._setShelfLevelCountAt(i, levelCount - 1)} ?disabled=${levelCount <= 1}>−</button>
                  <span class="stepper-val-sm">${levelCount}</span>
                  <button class="stepper-btn-sm" @click=${() => this._setShelfLevelCountAt(i, levelCount + 1)} ?disabled=${levelCount >= 6}>+</button>
                </div>
                <span class="row-type-info" style="flex:0">= ${sr.capacity}</span>
              </div>
            `;
          })}
        </div>
      `;
    }

    if (this._cabinetStyle === "bulk") {
      const capacity = this._bulkRow()?.capacity || 20;
      return html`
        <div class="stepper-row">
          <div class="stepper-wrap">
            <div class="stepper-label">${this._t("ui.rack.bulkCapacityLabel")}</div>
            <div class="stepper">
              <button class="stepper-btn" @click=${() => this._setBulkCapacity(capacity - 1)} ?disabled=${capacity <= 1}>−</button>
              <span class="stepper-value">${capacity}</span>
              <button class="stepper-btn" @click=${() => this._setBulkCapacity(capacity + 1)} ?disabled=${capacity >= 500}>+</button>
            </div>
          </div>
        </div>
      `;
    }

    // "box"
    const boxRow = this._boxRow();
    const boxes = boxRow?.boxes || [12];
    return html`
      <div class="stepper-row">
        <div class="stepper-wrap">
          <div class="stepper-label">${this._t("ui.rack.boxCountLabel")}</div>
          <div class="stepper">
            <button class="stepper-btn" @click=${() => this._updateBoxCount(boxes.length - 1)} ?disabled=${boxes.length <= 1}>−</button>
            <span class="stepper-value">${boxes.length}</span>
            <button class="stepper-btn" @click=${() => this._updateBoxCount(boxes.length + 1)} ?disabled=${boxes.length >= 10}>+</button>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${boxes.map((boxSize: number, bi: number) => html`
          <select
            class="row-cap-select"
            @change=${(e: Event) => this._updateBoxSize(bi, parseInt((e.target as HTMLSelectElement).value, 10))}
          >
            ${BOX_SIZES.map((s) => html`<option value=${s} ?selected=${boxSize === s}>${this._t('ui.rack.boxSizeOption', { s })}</option>`)}
          </select>
        `)}
        <span style="font-size:0.7em;color:var(--wc-text-secondary);">= ${boxRow?.capacity || 12}</span>
      </div>
    `;
  }

  private _renderForm() {
    const isEdit = this._mode === "edit";

    // Which bottles this edit would displace, whichever way it shrinks.
    const displaced = isEdit ? this._displacedWines() : [];

    return html`
      <div class="dialog-body">
        <div class="form-group">
          <label>${this._t("ui.rack.rackNameLabel")}</label>
          <input
            type="text"
            .value=${this._editCabinet.name || ""}
            @input=${(e: InputEvent) =>
              (this._editCabinet = {
                ...this._editCabinet,
                name: (e.target as HTMLInputElement).value,
              })}
          />
        </div>

        <!-- Rack style: exactly one of these four, chosen once -->
        <div class="form-group">
          <label>${this._t("ui.rack.styleLabel")}</label>
          <div class="style-toggle">
            <button
              class="style-toggle-btn ${this._cabinetStyle === "grid" ? "active" : ""}"
              @click=${() => this._setCabinetStyle("grid")}
            >${this._t("ui.rack.styleGrid")}</button>
            <button
              class="style-toggle-btn ${this._cabinetStyle === "shelf" ? "active" : ""}"
              @click=${() => this._setCabinetStyle("shelf")}
            >${getStorageRowTypeLabels(this.hass?.language).shelf}</button>
            <button
              class="style-toggle-btn ${this._cabinetStyle === "bulk" ? "active" : ""}"
              @click=${() => this._setCabinetStyle("bulk")}
            >${getStorageRowTypeLabels(this.hass?.language).bulk}</button>
            <button
              class="style-toggle-btn ${this._cabinetStyle === "box" ? "active" : ""}"
              @click=${() => this._setCabinetStyle("box")}
            >${getStorageRowTypeLabels(this.hass?.language).box}</button>
          </div>
        </div>

        <div class="grid-editor">${this._renderStyleForm()}</div>

        ${displaced.length > 0
          ? html`
              <div class="warning-msg">
                ${displaced.length > 1
                  ? this._t("ui.rack.warningBeforeMany", { n: displaced.length })
                  : this._t("ui.rack.warningBeforeOne")}
                <strong>${this._t("wineLocation.unassigned")}</strong>
                ${displaced.length > 1
                  ? this._t("ui.rack.warningAfterMany")
                  : this._t("ui.rack.warningAfterOne")}
                <div class="warning-list">
                  ${displaced.slice(0, 6).map(
                    (w) => html`<div>${w.name || this._t("ui.rack.unnamedWine")}</div>`
                  )}
                  ${displaced.length > 6
                    ? html`<div>${this._t("ui.rack.andNMore", { n: displaced.length - 6 })}</div>`
                    : nothing}
                </div>
              </div>
            `
          : nothing}

        ${this._error
          ? html`<div class="error-msg" style="color:#ef5350;margin-top:8px">${this._error}</div>`
          : nothing}
      </div>

      <div class="dialog-footer">
        <button class="btn btn-outline" @click=${() => (this._mode = "list")}>
          ${this._t("ui.common.cancel")}
        </button>
        <button
          class="btn btn-primary"
          @click=${isEdit ? this._saveEdit : this._saveAdd}
          ?disabled=${this._loading}
        >
          ${this._loading ? this._t("ui.wineDetail.saving") : this._t("ui.wineDetail.save")}
        </button>
      </div>
    `;
  }

  private _renderDeleteConfirm() {
    if (!this._deleteCabinet) return nothing;
    const count = this._winesInCabinet(this._deleteCabinet.id);

    return html`
      <div class="dialog-body">
        <div class="delete-info">
          ${this._t("ui.rack.deleteConfirmQuestion", { name: this._deleteCabinet.name })}
          ${count > 0
            ? html`<br /><span class="delete-count"
                >${count > 1 ? this._t("ui.rack.deleteWinesUnassignedMany", { count }) : this._t("ui.rack.deleteWinesUnassignedOne")}</span
              >`
            : nothing}
        </div>
        ${this._error
          ? html`<div style="color:#ef5350;font-size:0.85em">${this._error}</div>`
          : nothing}
      </div>
      <div class="dialog-footer">
        <button class="btn btn-outline" @click=${() => (this._mode = "list")}>
          ${this._t("ui.common.cancel")}
        </button>
        <button
          class="btn btn-primary"
          style="background:#c62828"
          @click=${this._confirmDelete}
          ?disabled=${this._loading}
        >
          ${this._loading ? this._t("ui.rack.deletingBtn") : this._t("ui.rack.deleteBtn")}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.open) return nothing;

    const titles: Record<Mode, string> = {
      list: this._t("ui.rack.dialogTitleManage"),
      add: this._t("ui.rack.dialogTitleAdd"),
      edit: this._t("ui.rack.dialogTitleEdit"),
      "delete-confirm": this._t("ui.rack.dialogTitleDeleteConfirm"),
    };

    return html`
      <div class="dialog-overlay" @click=${this._close}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header">${titles[this._mode]}</div>
          ${this._mode === "list" ? this._renderList() : nothing}
          ${this._mode === "add" || this._mode === "edit"
            ? this._renderForm()
            : nothing}
          ${this._mode === "delete-confirm"
            ? this._renderDeleteConfirm()
            : nothing}
        </div>
      </div>
    `;
  }
}
