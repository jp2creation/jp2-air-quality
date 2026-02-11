const CARD_TYPE = "jp2-air-quality";
const CARD_NAME = "JP2 Air Quality";
const CARD_DESC =
  "Mushroom + mini-graph stack with threshold bar and full visual editor.";

const CARD_VERSION = __BUILD_VERSION__;

const DEFAULT_NAME_BY_PRESET = {
  radon: "Radon",
  pressure: "Pression",
  humidity: "Humidité",
  temperature: "Température",
  voc: "COV / TVOC",
  pm1: "PM1",
  pm25: "PM2.5",
};

const DEFAULT_ICON_BY_PRESET = {
  radon: "mdi:radioactive",
  pressure: "mdi:gauge",
  humidity: "mdi:water-percent",
  temperature: "mdi:thermometer",
  voc: "mdi:air-filter",
  pm1: "mdi:weather-hazy",
  pm25: "mdi:weather-hazy",
};

class Jp2AirQualityCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._helpersPromise = null;
    this._top = null;
    this._graph = null;
    this._container = null;
  }

  static getStubConfig() {
    return {
      preset: "radon",
      entity: "",
      name: DEFAULT_NAME_BY_PRESET.radon,
      icon: DEFAULT_ICON_BY_PRESET.radon,
      show_graph: true,
      bar_enabled: true,
      background_enabled: false,
      hours_to_show: 24,
      graph_height: 20,
      line_width: 2,
      bar: {
        align: "center",
        width: 92,
        height: 6,
        good: "#45d58e",
        warn: "#ffb74d",
        bad: "#ff6363",
      },
    };
  }

  // ✅ Éditeur visuel simplifié :
  // - Plus de sections "Seuils Radon/..."
  // - Barre : uniquement largeur + hauteur + couleurs
  static getConfigForm() {
    const presetOptions = [
      { label: "Radon", value: "radon" },
      { label: "Pression", value: "pressure" },
      { label: "Humidité", value: "humidity" },
      { label: "Température", value: "temperature" },
      { label: "COV / TVOC", value: "voc" },
      { label: "PM1", value: "pm1" },
      { label: "PM2.5", value: "pm25" },
    ];

    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
        {
          type: "grid",
          name: "",
          flatten: true,
          column_min_width: "220px",
          schema: [
            { name: "preset", selector: { select: { options: presetOptions, mode: "dropdown" } } },
            { name: "name", selector: { text: {} } },
            { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
            { name: "show_graph", selector: { boolean: {} } },
            { name: "bar_enabled", selector: { boolean: {} } },
          ],
        },
        {
          type: "grid",
          name: "",
          flatten: true,
          column_min_width: "220px",
          schema: [
            { name: "hours_to_show", selector: { number: { min: 1, max: 168, step: 1, mode: "box" } } },
            { name: "graph_height", selector: { number: { min: 10, max: 80, step: 1, mode: "box" } } },
            { name: "line_width", selector: { number: { min: 1, max: 10, step: 1, mode: "box" } } },
          ],
        },

        // ✅ Barre : uniquement largeur / hauteur / couleurs
        {
          type: "expandable",
          name: "bar",
          title: "Barre (largeur / hauteur / couleurs)",
          schema: [
            { name: "align", selector: { select: { options: [
              { label: "Centré", value: "center" },
              { label: "Gauche", value: "left" },
              { label: "Droite", value: "right" },
            ], mode: "dropdown" } } },
            { name: "width", selector: { number: { min: 10, max: 100, step: 1, mode: "box" } } },
            { name: "height", selector: { number: { min: 2, max: 20, step: 1, mode: "box" } } },
            { name: "good", selector: { text: {} } },
            { name: "warn", selector: { text: {} } },
            { name: "bad", selector: { text: {} } },
          ],
        },

        {
          type: "expandable",
          name: "",
          title: "Avancé (templates + overrides)",
          flatten: true,
          schema: [
            { name: "secondary", selector: { template: {} } },
            { name: "color", selector: { template: {} } },
            { name: "mushroom", selector: { object: {} } },
            { name: "graph", selector: { object: {} } },
            { name: "name_by_preset", selector: { object: {} } },
            { name: "icon_by_preset", selector: { object: {} } },
          ],
        },
      ],

      computeLabel: (schema) => {
        const map = {
          entity: "Capteur",
          preset: "Preset",
          name: "Nom",
          icon: "Icône",
          show_graph: "Afficher le graphe",
          bar_enabled: "Afficher la barre",
          background_enabled: "Fond coloré",
          hours_to_show: "Heures affichées",
          graph_height: "Hauteur graphe",
          line_width: "Épaisseur ligne",
          align: "Alignement",
          width: "Largeur (%)",
          height: "Hauteur (px)",
          good: "Couleur vert",
          warn: "Couleur orange",
          bad: "Couleur rouge",
          secondary: "Secondary (template)",
          color: "Color (template)",
          mushroom: "Override mushroom (YAML)",
          graph: "Override graph (YAML)",
          name_by_preset: "Override noms (par preset)",
          icon_by_preset: "Override icônes (par preset)",
        };
        return map[schema.name];
      },

      computeHelper: (schema) => {
        switch (schema.name) {
          case "align":
            return "Position de la barre : gauche / centré / droite (défaut centré).";
          case "width":
            return "Largeur de la barre en pourcentage de la carte (10–100).";
          case "height":
            return "Hauteur (épaisseur) de la barre en pixels.";
          case "good":
          case "warn":
          case "bad":
            return "Couleur CSS : ex #45d58e, rgb(69,213,142), rgba(...).";
          case "bar_enabled":
            return "Active/désactive la barre colorée (seuils) au-dessus du graphe.";
          case "background_enabled":
            return "Colorise le fond de la carte selon la zone (vert/orange/rouge) de la valeur du capteur.";
          case "secondary":
            return "Si rempli, remplace le texte secondaire généré par le preset.";
          case "color":
            return "Si rempli, remplace la couleur (green/orange/red/disabled) générée par le preset.";
        }
        return undefined;
      },

      assertConfig: (config) => {
        if (config.mushroom && typeof config.mushroom !== "object") throw new Error("'mushroom' doit être un objet YAML.");
        if (config.graph && typeof config.graph !== "object") throw new Error("'graph' doit être un objet YAML.");
        if (config.name_by_preset && typeof config.name_by_preset !== "object") throw new Error("'name_by_preset' doit être un objet YAML.");
        if (config.icon_by_preset && typeof config.icon_by_preset !== "object") throw new Error("'icon_by_preset' doit être un objet YAML.");
      },
    };
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error(`${CARD_TYPE}: 'entity' est requis`);

    const defaults = {
      preset: "radon",
      name: DEFAULT_NAME_BY_PRESET.radon,
      icon: DEFAULT_ICON_BY_PRESET.radon,
      show_graph: true,
      bar_enabled: true,
      background_enabled: false,

      // Global mapping overrides
      name_by_preset: {},
      icon_by_preset: {},

      // ✅ Barre : show/hide (YAML), largeur/hauteur/couleurs
      bar: {
        enabled: true,
        align: "center",
        width: 92,
        height: 6,
        good: "#45d58e",
        warn: "#ffb74d",
        bad: "#ff6363",
      },

      // Preset thresholds (toujours supportés en YAML)
      radon: { offset: 0, min: 0, max: 300, good_max: 99, warn_max: 149, decimals: 1, unit_fallback: "Bq/m³", label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      voc:  { offset: 0, min: 0, max: 3000, good_max: 250, warn_max: 2000, decimals: 0, unit_fallback: "ppb", label_good: "Faible", label_warn: "À ventiler", label_bad: "Très élevé" },
      pm1:  { offset: 0, min: 0, max: 100, good_max: 10, warn_max: 25, decimals: 1, unit_fallback: "µg/m³", label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      pm25: { offset: 0, min: 0, max: 150, good_max: 12.0, warn_max: 35.4, decimals: 1, unit_fallback: "µg/m³", label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },

      pressure: { offset: 27, min: 970, max: 1050, fair_min: 995, good_min: 1005, good_max: 1025, fair_max: 1035, decimals: 0, unit_fallback: "hPa", label_good: "Normal", label_fair: "Variable", label_bad: "Extrême" },
      humidity: { offset: 0, min: 0, max: 100, fair_min: 30, good_min: 40, good_max: 60, fair_max: 70, decimals: 0, unit_fallback: "%", label_good: "Confort", label_fair: "Ok", label_bad: "Inconfort" },
      temperature: { offset: 0, min: 0, max: 35, fair_min: 17, good_min: 19, good_max: 23, fair_max: 26, decimals: 1, unit_fallback: "°C", label_good: "Confort", label_fair: "Ok", label_bad: "Alerte" },

      // Graph defaults
      hours_to_show: 24,
      graph_height: 20,
      line_width: 2,

      // Advanced overrides
      secondary: undefined,
      color: undefined,
      mushroom: {},
      graph: {},
    };

    this._config = {
      ...defaults,
      ...config,
      name_by_preset: { ...(config.name_by_preset || {}) },
      icon_by_preset: { ...(config.icon_by_preset || {}) },
      bar: { ...defaults.bar, ...(config.bar || {}) },

      radon: { ...defaults.radon, ...(config.radon || {}) },
      voc: { ...defaults.voc, ...(config.voc || {}) },
      pm1: { ...defaults.pm1, ...(config.pm1 || {}) },
      pm25: { ...defaults.pm25, ...(config.pm25 || {}) },

      pressure: { ...defaults.pressure, ...(config.pressure || {}) },
      humidity: { ...defaults.humidity, ...(config.humidity || {}) },
      temperature: { ...defaults.temperature, ...(config.temperature || {}) },

      mushroom: { ...(config.mushroom || {}) },
      graph: { ...(config.graph || {}) },
    };

    // Backward/Editor mapping: bar_enabled -> bar.enabled
    if (typeof this._config.bar_enabled === "boolean") {
      this._config.bar = { ...(this._config.bar || {}), enabled: this._config.bar_enabled };
    }

    // Default name/icon per preset if user didn't set them
    const nameMap = { ...DEFAULT_NAME_BY_PRESET, ...(this._config.name_by_preset || {}) };
    const iconMap = { ...DEFAULT_ICON_BY_PRESET, ...(this._config.icon_by_preset || {}) };

    if (!config.name) this._config.name = nameMap[this._config.preset] || "Capteur";
    if (!config.icon) this._config.icon = iconMap[this._config.preset] || "mdi:information";

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._top) this._top.hass = hass;
    if (this._graph) this._graph.hass = hass;
    this._updateBackground();
  }

  getCardSize() {
    return this._config?.show_graph ? 3 : 2;
  }

  async _getHelpers() {
    if (!this._helpersPromise) this._helpersPromise = window.loadCardHelpers();
    return this._helpersPromise;
  }


  _parseColorToRgba(color, alpha = 0.12) {
    if (!color) return "";
    const c = String(color).trim();
    // #RGB or #RRGGBB
    if (c[0] === "#") {
      const hex = c.slice(1);
      const h = hex.length === 3
        ? hex.split("").map((x) => x + x).join("")
        : hex.length === 6 ? hex : null;
      if (h) {
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      return "";
    }
    // rgb(...) -> rgba(...)
    const rgb = c.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;

    // rgba(...) -> same but override alpha
    const rgba = c.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
    if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;

    // unknown (named color etc.) fallback: try color-mix if supported by browser
    // We'll just return empty to avoid weird results.
    return "";
  }

  _getNumericState(entity) {
    if (!this._hass || !entity) return null;
    const st = this._hass.states?.[entity]?.state;
    if (st === undefined || st === null) return null;
    const v = parseFloat(st);
    return Number.isFinite(v) ? v : null;
  }

  _getZoneForValue(v) {
    if (v === null) return null;

    if (this._isAscendingPreset()) {
      const p = this._ascendingParams();
      const sl = v + Number(p.offset || 0);
      if (!Number.isFinite(sl)) return null;
      if (sl <= Number(p.good_max)) return "good";
      if (sl <= Number(p.warn_max)) return "warn";
      return "bad";
    }

    const p = this._bandedParams();
    const sl = v + Number(p.offset || 0);
    if (!Number.isFinite(sl)) return null;
    if (Number(p.good_min) <= sl && sl <= Number(p.good_max)) return "good";
    if (Number(p.fair_min) <= sl && sl <= Number(p.fair_max)) return "warn";
    return "bad";
  }

  _updateBackground() {
    if (!this._container) return;
    if (!this._config?.background_enabled) {
      this._container.style.background = "";
      return;
    }
    const v = this._getNumericState(this._config.entity);
    const zone = this._getZoneForValue(v);
    if (!zone) {
      this._container.style.background = "";
      return;
    }

    const b = this._config.bar || {};
    const alpha = 0.12;
    const src = zone === "good" ? b.good : zone === "warn" ? b.warn : b.bad;
    const rgba = this._parseColorToRgba(src, alpha);
    this._container.style.background = rgba || "";
  }
  _isAscendingPreset() {
    return ["radon", "voc", "pm1", "pm25"].includes(this._config.preset);
  }

  _ascendingParams() {
    const p = this._config.preset;
    if (p === "radon") return this._config.radon;
    if (p === "voc") return this._config.voc;
    if (p === "pm1") return this._config.pm1;
    if (p === "pm25") return this._config.pm25;
    return this._config.radon;
  }

  _bandedParams() {
    const p = this._config.preset;
    if (p === "pressure") return this._config.pressure;
    if (p === "humidity") return this._config.humidity;
    if (p === "temperature") return this._config.temperature;
    return this._config.pressure;
  }

  // ---------------------------
  // ASCENDING (vert -> orange -> rouge)
  // ---------------------------

  _secondaryTemplateAscending() {
    const p = this._ascendingParams();
    const off = Number(p.offset || 0);
    const decimals = Number.isFinite(Number(p.decimals)) ? Number(p.decimals) : 0;

    const unitFallback = (p.unit_fallback || "").replace(/'/g, "");
    const labelGood = (p.label_good || "Bon").replace(/'/g, "");
    const labelWarn = (p.label_warn || "Moyen").replace(/'/g, "");
    const labelBad = (p.label_bad || "Mauvais").replace(/'/g, "");

    const goodMax = Number(p.good_max);
    const warnMax = Number(p.warn_max);

    return `
{% set v = states(entity) | float(none) %}
{% set off = ${off} %}
{% set sl = (v + off) if v is not none else none %}
{% if sl is none %}
—
{% else %}
  {{ sl | round(${decimals}) }} {{ state_attr(entity,'unit_of_measurement') or '${unitFallback}' }} ·
  {% if sl <= ${goodMax} %} ${labelGood}
  {% elif sl <= ${warnMax} %} ${labelWarn}
  {% else %} ${labelBad}
  {% endif %}
{% endif %}`.trim();
  }

  _colorTemplateAscending() {
    const p = this._ascendingParams();
    const off = Number(p.offset || 0);
    const goodMax = Number(p.good_max);
    const warnMax = Number(p.warn_max);
    return `
{% set v = states(entity) | float(none) %}
{% set off = ${off} %}
{% set sl = (v + off) if v is not none else none %}
{% if sl is none %} disabled
{% elif sl <= ${goodMax} %} green
{% elif sl <= ${warnMax} %} orange
{% else %} red
{% endif %}`.trim();
  }

  _barStyleCommon() {
    const b = this._config.bar || {};
    const enabled = b.enabled !== false; // default true
    const width = Number.isFinite(Number(b.width)) ? Number(b.width) : 92;
    const height = Number.isFinite(Number(b.height)) ? Number(b.height) : 6;

    const good = (b.good || "#45d58e").replace(/"/g, '\\"');
    const warn = (b.warn || "#ffb74d").replace(/"/g, '\\"');
    const bad = (b.bad || "#ff6363").replace(/"/g, '\\"');

    const align = (b.align || "center");
    const alignNorm = (align === "left" || align === "right" || align === "center") ? align : "center";
    return { enabled, width, height, good, warn, bad, align: alignNorm };
  }

  _barStyleAscending() {
    const p = this._ascendingParams();
    const min = Number(p.min), max = Number(p.max);
    const goodMax = Number(p.good_max), warnMax = Number(p.warn_max);
    const off = Number(p.offset || 0);

    const goodPct = ((goodMax - min) / (max - min)) * 100;
    const warnPct = ((warnMax - min) / (max - min)) * 100;

    const bar = this._barStyleCommon();
    const barBlock = (() => {
      if (!bar.enabled) {
        return `ha-card:before{ content:none !important; }\nha-card:after{ content:none !important; }`;
      }
      if (bar.align === "left") {
        return `
ha-card:before{
  content:"";
  position:absolute;
  left:16px;
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(16px + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
      }
      if (bar.align === "right") {
        return `
ha-card:before{
  content:"";
  position:absolute;
  right:16px;
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc((100% - 16px - var(--bar_w)) + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
      }
      // center (default)
      return `
ha-card:before{
  content:"";
  position:absolute;
  left: calc((100% - var(--bar_w)) / 2);
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(((100% - var(--bar_w)) / 2) + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
    })();
    return `
ha-card{
  box-shadow:none;
  border-radius:0;
  background:none;
  position:relative;
  overflow:hidden;
  padding-bottom:${bar.enabled ? 14 : 0}px;

  --bar_w: ${bar.width}%;
  --bar_h: ${bar.height}px;

  --good: ${bar.good};
  --warn: ${bar.warn};
  --bad:  ${bar.bad};

  --good_track: var(--good);
  --warn_track: var(--warn);
  --bad_track:  var(--bad);

  --good_fill:  var(--good);
  --warn_fill:  var(--warn);
  --bad_fill:   var(--bad);

  @supports (color: color-mix(in srgb, red 50%, transparent)) {
    --good_track: color-mix(in srgb, var(--good) 30%, transparent);
    --warn_track: color-mix(in srgb, var(--warn) 30%, transparent);
    --bad_track:  color-mix(in srgb, var(--bad) 30%, transparent);

    --good_fill:  color-mix(in srgb, var(--good) 95%, transparent);
    --warn_fill:  color-mix(in srgb, var(--warn) 95%, transparent);
    --bad_fill:   color-mix(in srgb, var(--bad) 95%, transparent);
  }

  {% set v = states(config.entity) | float(none) %}
  {% set off = ${off} %}
  {% set sl = (v + off) if v is not none else none %}

  --p: {% if sl is none %}0{% else %}
       {% set p = ((sl - ${min}) / (${max} - ${min}) * 100) %}
       {{ [0, [p, 100] | min] | max }}
       {% endif %};
  --thumb_opacity: {% if sl is none %}0{% else %}1{% endif %};

  --fill: {% if sl is none %} rgba(180,190,200,0.55)
         {% elif sl <= ${goodMax} %} var(--good_fill)
         {% elif sl <= ${warnMax} %} var(--warn_fill)
         {% else %} var(--bad_fill)
         {% endif %};

  --track: linear-gradient(90deg,
    var(--good_track) 0%,
    var(--good_track) ${goodPct.toFixed(2)}%,
    var(--warn_track) ${goodPct.toFixed(2)}%,
    var(--warn_track) ${warnPct.toFixed(2)}%,
    var(--bad_track)  ${warnPct.toFixed(2)}%,
    var(--bad_track)  100%
  );
}
${barBlock}`.trim();
  }

  // ---------------------------
  // BANDED (rouge/orange/vert/orange/rouge)
  // ---------------------------

  _secondaryTemplateBanded() {
    const p = this._bandedParams();
    const off = Number(p.offset || 0);
    const decimals = Number.isFinite(Number(p.decimals)) ? Number(p.decimals) : 0;

    const unitFallback = (p.unit_fallback || "").replace(/'/g, "");
    const labelGood = (p.label_good || "Bon").replace(/'/g, "");
    const labelFair = (p.label_fair || "Moyen").replace(/'/g, "");
    const labelBad = (p.label_bad || "Mauvais").replace(/'/g, "");

    return `
{% set v = states(entity) | float(none) %}
{% set off = ${off} %}
{% set sl = (v + off) if v is not none else none %}
{% if sl is none %}
—
{% else %}
  {{ sl | round(${decimals}) }} {{ state_attr(entity,'unit_of_measurement') or '${unitFallback}' }} ·
  {% if ${Number(p.good_min)} <= sl <= ${Number(p.good_max)} %} ${labelGood}
  {% elif ${Number(p.fair_min)} <= sl <= ${Number(p.fair_max)} %} ${labelFair}
  {% else %} ${labelBad}
  {% endif %}
{% endif %}`.trim();
  }

  _colorTemplateBanded() {
    const p = this._bandedParams();
    const off = Number(p.offset || 0);
    return `
{% set v = states(entity) | float(none) %}
{% set off = ${off} %}
{% set sl = (v + off) if v is not none else none %}
{% if sl is none %} disabled
{% elif ${Number(p.good_min)} <= sl <= ${Number(p.good_max)} %} green
{% elif ${Number(p.fair_min)} <= sl <= ${Number(p.fair_max)} %} orange
{% else %} red
{% endif %}`.trim();
  }

  _barStyleBanded() {
    const p = this._bandedParams();
    const min = Number(p.min), max = Number(p.max);
    const fairMin = Number(p.fair_min),
      goodMin = Number(p.good_min),
      goodMax = Number(p.good_max),
      fairMax = Number(p.fair_max);
    const off = Number(p.offset || 0);

        const bar = this._barStyleCommon();
    const barBlock = (() => {
      if (!bar.enabled) {
        return `ha-card:before{ content:none !important; }\nha-card:after{ content:none !important; }`;
      }
      if (bar.align === "left") {
        return `
ha-card:before{
  content:"";
  position:absolute;
  left:16px;
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(16px + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
      }
      if (bar.align === "right") {
        return `
ha-card:before{
  content:"";
  position:absolute;
  right:16px;
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc((100% - 16px - var(--bar_w)) + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
      }
      // center (default)
      return `
ha-card:before{
  content:"";
  position:absolute;
  left: calc((100% - var(--bar_w)) / 2);
  width: var(--bar_w);
  bottom:8px;
  height: var(--bar_h);
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(((100% - var(--bar_w)) / 2) + (var(--bar_w) * (var(--p) / 100)));
  bottom: calc(8px + (var(--bar_h) - 10px)/2);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translateX(-50%);
  background: var(--fill);
  box-shadow: 0 0 0 2px rgba(0,0,0,0.85);
  opacity: var(--thumb_opacity);
  pointer-events: none;
}`.trim();
    })();
    return `
ha-card{
  box-shadow:none;
  border-radius:0;
  background:none;
  position: relative;
  overflow: hidden;
  padding-bottom:${bar.enabled ? 14 : 0}px;

  --bar_w: ${bar.width}%;
  --bar_h: ${bar.height}px;

  --good: ${bar.good};
  --warn: ${bar.warn};
  --bad:  ${bar.bad};

  --good_track: var(--good);
  --warn_track: var(--warn);
  --bad_track:  var(--bad);

  --good_fill:  var(--good);
  --warn_fill:  var(--warn);
  --bad_fill:   var(--bad);

  @supports (color: color-mix(in srgb, red 50%, transparent)) {
    --good_track: color-mix(in srgb, var(--good) 30%, transparent);
    --warn_track: color-mix(in srgb, var(--warn) 30%, transparent);
    --bad_track:  color-mix(in srgb, var(--bad) 30%, transparent);

    --good_fill:  color-mix(in srgb, var(--good) 95%, transparent);
    --warn_fill:  color-mix(in srgb, var(--warn) 95%, transparent);
    --bad_fill:   color-mix(in srgb, var(--bad) 95%, transparent);
  }

  {% set v = states(config.entity) | float(none) %}
  {% set off = ${off} %}
  {% set sl = (v + off) if v is not none else none %}

  --p: {% if sl is none %}0{% else %}
       {% set p = ((sl - ${min}) / (${max} - ${min}) * 100) %}
       {{ [0, [p, 100] | min] | max }}
       {% endif %};
  --thumb_opacity: {% if sl is none %}0{% else %}1{% endif %};

  --fill: {% if sl is none %} rgba(180,190,200,0.55)
         {% elif ${goodMin} <= sl <= ${goodMax} %} var(--good_fill)
         {% elif ${fairMin} <= sl <= ${fairMax} %} var(--warn_fill)
         {% else %} var(--bad_fill)
         {% endif %};

  --p_fmin: {{ ((${fairMin}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_gmin: {{ ((${goodMin}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_gmax: {{ ((${goodMax}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_fmax: {{ ((${fairMax}-${min})/(${max}-${min})*100) | round(2) }}%;

  --track: linear-gradient(90deg,
    var(--bad_track) 0%,
    var(--bad_track) var(--p_fmin),
    var(--warn_track) var(--p_fmin),
    var(--warn_track) var(--p_gmin),
    var(--good_track) var(--p_gmin),
    var(--good_track) var(--p_gmax),
    var(--warn_track) var(--p_gmax),
    var(--warn_track) var(--p_fmax),
    var(--bad_track)  var(--p_fmax),
    var(--bad_track)  100%
  );
}
${barBlock}`.trim();
  }

  _miniGraphResetStyle() {
    return `
ha-card{
  box-shadow:none;
  border-radius:0;
  background:none;
  margin-top:-6px;
}`.trim();
  }

  _graphThresholdsByPreset() {
    if (this._isAscendingPreset()) {
      const p = this._ascendingParams();
      return [
        { value: Number(p.min), color: "green" },
        { value: Number(p.good_max), color: "orange" },
        { value: Number(p.warn_max), color: "red" },
      ];
    }

    const p = this._bandedParams();
    return [
      { value: Number(p.min), color: "red" },
      { value: Number(p.fair_min), color: "orange" },
      { value: Number(p.good_min), color: "green" },
      { value: Number(p.good_max), color: "orange" },
      { value: Number(p.fair_max), color: "red" },
      { value: Number(p.max), color: "red" },
    ];
  }

  _buildTopCardConfig() {
    const secondary =
      this._config.secondary ??
      (this._isAscendingPreset()
        ? this._secondaryTemplateAscending()
        : this._secondaryTemplateBanded());

    const color =
      this._config.color ??
      (this._isAscendingPreset()
        ? this._colorTemplateAscending()
        : this._colorTemplateBanded());

    const barStyle =
      this._isAscendingPreset() ? this._barStyleAscending() : this._barStyleBanded();

    const base = {
      type: "custom:mushroom-template-card",
      entity: this._config.entity,
      primary: this._config.name,
      secondary,
      icon: this._config.icon,
      tap_action: { action: "more-info" },
      color,
      features_position: "bottom",
      card_mod: { style: barStyle },
    };

    return { ...base, ...(this._config.mushroom || {}) };
  }

  _buildGraphCardConfig() {
    const base = {
      type: "custom:mini-graph-card",
      entities: [{ entity: this._config.entity }],
      show: {
        name: false,
        legend: false,
        icon: false,
        labels: false,
        extrema: false,
        average: false,
        state: false,
        fill: false,
      },
      color_thresholds_transition: "smooth",
      line_width: this._config.line_width,
      height: this._config.graph_height,
      hours_to_show: this._config.hours_to_show,
      icon: this._config.icon,
      name: this._config.name,
      color_thresholds: this._graphThresholdsByPreset(),
      card_mod: { style: this._miniGraphResetStyle() },
    };

    return { ...base, ...(this._config.graph || {}) };
  }

  async _render() {
    if (!this._config) return;
    const helpers = await this._getHelpers();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { padding:0; overflow:hidden; }
        .stack { display:flex; flex-direction:column; gap:0; }
        .divider {
          height:1px;
          background: var(--divider-color, rgba(255,255,255,0.12));
          opacity:.6;
          margin: 0 16px;
        }
      </style>
      <ha-card>
        <div class="stack" id="stack"></div>
      </ha-card>
    `;

    const stack = this.shadowRoot.getElementById("stack");
    stack.innerHTML = "";

    const topConf = this._buildTopCardConfig();
    this._top = helpers.createCardElement(topConf);
    this._top.addEventListener("ll-rebuild", (e) => {
      e.stopPropagation();
      this._render();
    });
    stack.appendChild(this._top);

    if (this._config.show_graph) {
      const div = document.createElement("div");
      div.className = "divider";
      stack.appendChild(div);

      const graphConf = this._buildGraphCardConfig();
      this._graph = helpers.createCardElement(graphConf);
      this._graph.addEventListener("ll-rebuild", (e) => {
        e.stopPropagation();
        this._render();
      });
      stack.appendChild(this._graph);
    } else {
      this._graph = null;
    this._container = null;
    }

    if (this._hass) this.hass = this._hass;
    this._updateBackground();
  }
}

customElements.define(CARD_TYPE, Jp2AirQualityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: CARD_NAME,
  description: CARD_DESC,
  version: CARD_VERSION,
});

console.info(
  `%c ${CARD_NAME} %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
