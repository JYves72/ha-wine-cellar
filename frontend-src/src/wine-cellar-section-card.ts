import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import { Wine, Cabinet, StorageRow } from "./models";
import { t, tGroup } from "./i18n";
import { containersOf, containerCapacity, containerUsage, storageRowFor } from "./utils/location";
import "./components/cabinet-grid";
import "./components/wine-detail-dialog";
import "./components/add-wine-dialog";

// One rack of the cellar as its own card, for a dashboard tile: the rack's
// grid, its bottle count, a bottle's detail on tap and "add here" on an empty
// slot. Everything else (moving bottles, racks, Vivino, search) stays in the
// full Cork Dork card.

interface SectionCardConfig {
  type: string;
  // Rack id or name (case-insensitive).
  section?: string;
  title?: string;
  show_header?: boolean;
}

interface Picker {
  title: string;
  wines: Wine[];
  // Where "add here" goes, when the container still has room.
  add?: { cabinet: string; row: number | null; col: number | null; zone: string; depth: number };
}

export function findSection(cabinets: Cabinet[], section?: string): Cabinet | undefined {
  if (!section) return undefined;
  const wanted = section.trim().toLowerCase();
  return (
    cabinets.find((c) => c.id === section) ||
    cabinets.find((c) => (c.name || "").trim().toLowerCase() === wanted)
  );
}

@customElement("wine-cellar-section-card")
export class WineCellarSectionCard extends LitElement {
  @property({ attribute: false }) hass: any;

  @state() private _config: SectionCardConfig = { type: "" };
  @state() private _cabinets: Cabinet[] = [];
  @state() private _wines: Wine[] = [];
  @state() private _loaded = false;
  @state() private _error = "";
  @state() private _hasGemini = false;
  @state() private _aiFallbackAlways = false;
  @state() private _currency = "USD";
  @state() private _enableWhisky = false;
  @state() private _enableCider = false;
  @state() private _showVivinoAwards = false;
  @state() private _defaultWineType = "red";
  @state() private _dispositionDisplay = "letter";
  @state() private _chamberingRoomSensor = "";
  @state() private _chamberingTimeConstantMinutes = 75;
  @state() private _chamberingEquilibrationHours = 24;

  @state() private _selectedWine: Wine | null = null;
  @state() private _showDetail = false;
  @state() private _picker: Picker | null = null;
  @state() private _showAdd = false;
  @state() private _addAt: Picker["add"] | null = null;
  @state() private _notice = "";

  private _unsubscribe: (() => void) | null = null;
  private _subscribing = false;
  private _generation = 0;
  private _refreshTimer: number | undefined;
  private _noticeTimer: number | undefined;

  static styles = [
    sharedStyles,
    css`
      ha-card {
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 16px 0;
      }
      .title {
        font-weight: 600;
        font-size: 1.05em;
        color: var(--wc-text);
      }
      .counts {
        font-size: 0.85em;
        color: var(--wc-text-secondary);
        white-space: nowrap;
      }
      .grid-wrap {
        padding: 8px 12px 12px;
      }
      .message {
        padding: 16px;
        color: var(--wc-text-secondary);
        font-size: 0.9em;
      }
      .message b {
        color: var(--wc-text);
      }
      .notice {
        margin: 0 12px 12px;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(114, 47, 55, 0.12);
        color: var(--wc-text);
        font-size: 0.85em;
      }
      .picker-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 7;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      .picker {
        background: var(--wc-surface);
        color: var(--wc-text);
        width: min(480px, 100%);
        max-height: 70vh;
        overflow: auto;
        border-radius: 16px 16px 0 0;
        padding: 12px 16px 20px;
      }
      .picker h3 {
        margin: 4px 0 10px;
        font-size: 1em;
      }
      .picker-item {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 10px 8px;
        border: none;
        border-bottom: 1px solid var(--wc-border);
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .picker-item small {
        color: var(--wc-text-secondary);
      }
      .picker-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
      }
      .picker-actions button {
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid var(--wc-border);
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .picker-actions button.primary {
        background: var(--wc-primary);
        border-color: var(--wc-primary);
        color: #fff;
      }
    `,
  ];

  setConfig(config: SectionCardConfig) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { show_header: true, ...config };
  }

  static getConfigElement() {
    return document.createElement("wine-cellar-section-card-editor");
  }

  static getStubConfig() {
    return { type: "custom:wine-cellar-section-card", section: "" };
  }

  getCardSize() {
    const cab = this._cabinet;
    return cab ? Math.max(2, Math.ceil(cab.rows / 2) + 1) : 3;
  }

  // Sections dashboards: default to half width, height follows the rack.
  getGridOptions() {
    return { columns: 6, min_columns: 3 };
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._subscribe();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._generation++;
    this._unsubscribe?.();
    this._unsubscribe = null;
    window.clearTimeout(this._refreshTimer);
    window.clearTimeout(this._noticeTimer);
  }

  protected updated(changed: Map<string, unknown>) {
    // hass arrives after connectedCallback on first render.
    if (changed.has("hass") && this.hass && !this._loaded && !this._error) {
      this._load();
      this._subscribe();
    }
  }

  private get _cabinet(): Cabinet | undefined {
    return findSection(this._cabinets, this._config.section);
  }

  private async _load() {
    if (!this.hass) return;
    try {
      const [wines, cabinets, caps] = await Promise.all([
        this.hass.callWS({ type: "wine_cellar/get_wines" }),
        this.hass.callWS({ type: "wine_cellar/get_cabinets" }),
        this.hass.callWS({ type: "wine_cellar/get_capabilities" }).catch(() => ({})),
      ]);
      this._wines = wines.wines || [];
      this._cabinets = (cabinets.cabinets || []).sort((a: Cabinet, b: Cabinet) => a.order - b.order);
      this._hasGemini = !!caps?.has_gemini;
      this._aiFallbackAlways = !!caps?.ai_fallback_always;
      this._currency = caps?.metadata_currency || "USD";
      // Same settings as the full card passes, so the dialogs behave alike.
      this._enableWhisky = !!caps?.enable_whisky;
      this._enableCider = !!caps?.enable_cider;
      this._showVivinoAwards = !!caps?.show_vivino_awards;
      this._defaultWineType = caps?.default_wine_type || "red";
      this._dispositionDisplay = caps?.disposition_display || "letter";
      this._chamberingRoomSensor = caps?.chambering_room_sensor || "";
      this._chamberingTimeConstantMinutes = caps?.chambering_time_constant_minutes ?? 75;
      this._chamberingEquilibrationHours = caps?.chambering_equilibration_hours ?? 24;
      this._error = "";
      this._loaded = true;
      if (this._selectedWine) {
        this._selectedWine = this._wines.find((w) => w.id === this._selectedWine!.id) || null;
        if (!this._selectedWine) this._showDetail = false;
      }
    } catch (err: any) {
      this._error = err?.message || this._t("ui.sectionCard.unavailable");
    }
  }

  private async _subscribe() {
    if (!this.hass?.connection || this._unsubscribe || this._subscribing) return;
    this._subscribing = true;
    const generation = this._generation;
    try {
      const unsub = await this.hass.connection.subscribeEvents(() => {
        // Background work fires bursts of events; one reload covers them.
        window.clearTimeout(this._refreshTimer);
        this._refreshTimer = window.setTimeout(() => this._load(), 400);
      }, "wine_cellar_updated");
      // Detached while subscribing (dashboard tab switch): drop it.
      if (generation !== this._generation) {
        unsub();
        return;
      }
      this._unsubscribe = unsub;
    } catch {
      // Still usable; it just will not notice changes made elsewhere.
    } finally {
      this._subscribing = false;
    }
  }

  private _t(key: string, params?: Record<string, string | number>): string {
    return t(key, this.hass?.language, params);
  }

  private _toast(text: string) {
    this._notice = text;
    window.clearTimeout(this._noticeTimer);
    this._noticeTimer = window.setTimeout(() => (this._notice = ""), 4000);
  }

  private _openWine(wine: Wine) {
    this._picker = null;
    this._selectedWine = wine;
    this._showDetail = true;
  }

  private _openAdd(at: NonNullable<Picker["add"]>) {
    this._picker = null;
    this._addAt = at;
    this._showAdd = true;
  }

  private _onCellClick(e: CustomEvent) {
    const { wine, wines = [], cabinet, row, col, wineCount = 0, cabinetDepth = 1 } = e.detail;
    const stack: Wine[] = [...(wines.length ? wines : wine ? [wine] : [])].sort(
      (a, b) => (a.depth || 0) - (b.depth || 0)
    );
    const add =
      wineCount < cabinetDepth
        ? { cabinet: cabinet.id, row, col, zone: "", depth: this._firstFreeDepth(stack) }
        : undefined;
    if (stack.length === 1 && cabinetDepth < 2) return this._openWine(stack[0]);
    if (stack.length === 0 && add) return this._openAdd(add);
    this._picker = { title: this._t("ui.sectionCard.slotTitle", { row: row + 1, col: col + 1 }), wines: stack, add };
  }

  private _onZoneClick(e: CustomEvent) {
    const { wine, cabinet, zone, depth } = e.detail;
    if (wine) return this._openWine(wine);
    const z = zone || "bottom";
    // Slot zones (shelf/quinconce) send the exact slot clicked: land there,
    // as the full card does; bins take their first free slot.
    const occupants = this._wines.filter((w) => w.cabinet_id === cabinet.id && w.zone === z);
    const at = depth !== undefined ? depth : this._firstFreeDepth(occupants);
    this._openAdd({ cabinet: cabinet.id, row: null, col: null, zone: z, depth: at });
  }

  private _onZoneContainerClick(e: CustomEvent) {
    const { cabinet, zone, storageRow } = e.detail as { cabinet: Cabinet; zone: string; storageRow?: StorageRow };
    const occupants = this._wines
      .filter((w) => w.cabinet_id === cabinet.id && w.zone === zone)
      .sort((a, b) => (a.depth || 0) - (b.depth || 0));
    // Shared capacity rules (boxes, shelves, stepped rows) from utils/location.
    const usage = containerUsage(
      { cabinetId: cabinet.id, kind: "zone", zone, row: null, col: null },
      cabinet,
      this._wines
    );
    const add = usage.full
      ? undefined
      : { cabinet: cabinet.id, row: null, col: null, zone, depth: usage.nextDepth };
    const name = storageRow?.name || storageRowFor(cabinet, zone)?.name || tGroup("wineLocation", this.hass?.language).storage;
    this._picker = { title: name, wines: occupants, add };
  }

  // First depth no bottle uses, so a gap left by a removed bottle is reused
  // (the same rule as the full card).
  private _firstFreeDepth(wines: Wine[]): number {
    const used = new Set(wines.map((w) => w.depth || 0));
    let d = 0;
    while (used.has(d)) d++;
    return d;
  }

  private async _onRemoveWine(e: CustomEvent) {
    try {
      await this.hass.callWS({
        type: "wine_cellar/remove_wine",
        wine_id: e.detail.wine_id,
        reason: e.detail.reason || "other",
      });
      this._showDetail = false;
      await this._load();
    } catch (err) {
      console.error("Wine Cellar: failed to remove wine", err);
    }
  }

  // "Always fall back to AI" ticked in the wine sheet: save it, as the full card does.
  private async _setAiFallbackAlways(value: boolean) {
    if (value === this._aiFallbackAlways) return;
    const previous = this._aiFallbackAlways;
    this._aiFallbackAlways = value;
    try {
      await this.hass.callWS({
        type: "wine_cellar/update_settings",
        updates: { ai_fallback_always: value },
      });
    } catch {
      this._aiFallbackAlways = previous;
      this._toast(this._t("toast.changeAiFallbackFailed"));
    }
  }

  private _onFullCardOnly() {
    this._showDetail = false;
    this._toast(this._t("ui.sectionCard.fullCardOnly"));
  }

  render() {
    const cab = this._cabinet;
    const header = this._config.show_header !== false;

    if (this._error) {
      return html`<ha-card><div class="message">${this._error}</div></ha-card>`;
    }
    if (!this._loaded) {
      return html`<ha-card><div class="message">${this._t("ui.sectionCard.loading")}</div></ha-card>`;
    }
    if (!cab) {
      const names = this._cabinets.map((c) => c.name).join(", ");
      return html`
        <ha-card>
          <div class="message">
            ${this._config.section
              ? this._t("ui.sectionCard.noSectionNamed", { name: this._config.section })
              : this._t("ui.sectionCard.chooseSection")}
            ${names ? html`<br />${this._t("ui.sectionCard.sectionsList", { names })}` : nothing}
          </div>
        </ha-card>
      `;
    }

    const wines = this._wines.filter((w) => w.cabinet_id === cab.id);
    // Grid slots × depth plus every bin, box and shelf (the bottom zone has
    // no limit and is left out), using the shared capacity rules.
    const capacity = containersOf(cab).reduce((sum, c) => sum + containerCapacity(c, cab), 0);

    return html`
      <ha-card>
        ${header
          ? html`
              <div class="header">
                <!-- The grid already shows the rack's name; only a custom
                     title is worth a line of its own. -->
                <span class="title">${this._config.title || ""}</span>
                <span class="counts">
                  ${this._t(wines.length === 1 ? "ui.sectionCard.bottlesOne" : "ui.sectionCard.bottlesMany", { n: wines.length })}
                  ${capacity ? html` · ${this._t("ui.sectionCard.free", { n: Math.max(0, capacity - wines.length) })}` : nothing}
                </span>
              </div>
            `
          : nothing}
        <div class="grid-wrap">
          <cabinet-grid
            .hass=${this.hass}
            .cabinet=${cab}
            .wines=${wines}
            .dispositionDisplay=${this._dispositionDisplay}
            @cell-click=${this._onCellClick}
            @zone-click=${this._onZoneClick}
            @zone-container-click=${this._onZoneContainerClick}
            @cabinet-updated=${() => this._load()}
          ></cabinet-grid>
        </div>
        ${this._notice ? html`<div class="notice">${this._notice}</div>` : nothing}
      </ha-card>

      ${this._picker ? this._renderPicker(this._picker) : nothing}

      <wine-detail-dialog
        .wine=${this._selectedWine}
        .wines=${this._wines}
        .hass=${this.hass}
        .cabinets=${this._cabinets}
        .open=${this._showDetail}
        .hasGemini=${this._hasGemini}
        .aiFallbackAlways=${this._aiFallbackAlways}
        .showVivinoAwards=${this._showVivinoAwards}
        .enableWhisky=${this._enableWhisky}
        .enableCider=${this._enableCider}
        .currency=${this._currency}
        .mode=${"cellar"}
        .chamberingRoomSensor=${this._chamberingRoomSensor}
        .chamberingTimeConstantMinutes=${this._chamberingTimeConstantMinutes}
        .chamberingEquilibrationHours=${this._chamberingEquilibrationHours}
        @close=${() => (this._showDetail = false)}
        @remove-wine=${this._onRemoveWine}
        @wine-updated=${() => this._load()}
        @move-wine=${this._onFullCardOnly}
        @copy-wine=${this._onFullCardOnly}
        @locate-wine=${() => (this._showDetail = false)}
        @set-ai-fallback-always=${(e: CustomEvent) => this._setAiFallbackAlways(e.detail.value)}
      ></wine-detail-dialog>

      <add-wine-dialog
        .open=${this._showAdd}
        .hass=${this.hass}
        .cabinets=${this._cabinets}
        .wines=${this._wines}
        .preselectedCabinet=${this._addAt?.cabinet || ""}
        .preselectedRow=${this._addAt?.row ?? null}
        .preselectedCol=${this._addAt?.col ?? null}
        .preselectedZone=${this._addAt?.zone || ""}
        .preselectedDepth=${this._addAt?.depth || 0}
        .enableWhisky=${this._enableWhisky}
        .enableCider=${this._enableCider}
        .defaultWineType=${this._defaultWineType}
        @close=${() => (this._showAdd = false)}
        @wine-added=${() => this._load()}
      ></add-wine-dialog>
    `;
  }

  private _renderPicker(p: Picker) {
    return html`
      <div class="picker-backdrop" @click=${() => (this._picker = null)}>
        <div class="picker" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${p.title}</h3>
          ${p.wines.length
            ? p.wines.map(
                (w, i) => html`
                  <button class="picker-item" @click=${() => this._openWine(w)}>
                    <span>${w.winery ? `${w.winery} — ` : ""}${w.name}${w.vintage ? ` ${w.vintage}` : ""}</span>
                    <small>${i + 1}</small>
                  </button>
                `
              )
            : html`<div class="message">${this._t("ui.common.empty")}</div>`}
          <div class="picker-actions">
            <button @click=${() => (this._picker = null)}>${this._t("ui.common.close")}</button>
            ${p.add
              ? html`<button class="primary" @click=${() => this._openAdd(p.add!)}>${this._t("ui.sectionCard.addHere")}</button>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

// Visual editor: pick the section from the cellar's racks.
@customElement("wine-cellar-section-card-editor")
export class WineCellarSectionCardEditor extends LitElement {
  @property({ attribute: false }) hass: any;
  @state() private _config: SectionCardConfig = { type: "" };
  @state() private _cabinets: Cabinet[] = [];
  private _fetched = false;

  setConfig(config: SectionCardConfig) {
    this._config = config;
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("hass") && this.hass && !this._fetched) {
      this._fetched = true;
      this.hass
        .callWS({ type: "wine_cellar/get_cabinets" })
        .then((r: any) => {
          this._cabinets = (r.cabinets || []).sort((a: Cabinet, b: Cabinet) => a.order - b.order);
        })
        .catch(() => (this._cabinets = []));
    }
  }

  private _schema() {
    return [
      {
        name: "section",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: this._cabinets.map((c) => ({ value: c.id, label: c.name })),
          },
        },
      },
      { name: "title", selector: { text: {} } },
      { name: "show_header", selector: { boolean: {} } },
    ];
  }

  private _label = (s: { name: string }) => {
    const key = ({ section: "section", title: "title", show_header: "showHeader" } as Record<string, string>)[s.name];
    return key ? t(`ui.sectionCard.editor.${key}`, this.hass?.language) : s.name;
  };

  render() {
    if (!this.hass) return nothing;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{ show_header: true, ...this._config }}
        .schema=${this._schema()}
        .computeLabel=${this._label}
        @value-changed=${(e: CustomEvent) => {
          const config = { ...this._config, ...e.detail.value };
          if (!config.title) delete config.title;
          this.dispatchEvent(
            new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
          );
        }}
      ></ha-form>
    `;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "wine-cellar-section-card",
  name: "Cork Dork — Section",
  description: "One rack of your cellar as a tile: its bottles, tap for details, add to a free slot",
  preview: false,
});
