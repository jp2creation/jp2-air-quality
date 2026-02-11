const CARD_TYPE = "jp2-air-quality";
const CARD_NAME = "JP2 Air Quality";
const CARD_DESC = "Mushroom + mini-graph stack with threshold bar and full visual editor.";

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
  }

  // UI stub config (sans "type", HA l'ajoute)
  static getStubConfig() {
    return {
      preset: "radon",
      entity: "",
      name: DEFAULT_NAME_BY_PRESET.radon,
      icon: DEFAULT_ICON_BY_PRESET.radon,
      show_graph: true,
      hours_to_show: 24,
      graph_height: 20,
      line_width: 2,
    };
  }

  // UI: éditeur visuel complet via ha-form
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

    const ascendingSchema = (min, max, step = 1) => [
      { name: "offset", selector: { number: { min: -5000, max: 5000, step, mode: "box" } } },
      { name: "min", selector: { number: { min, max, step, mode: "box" } } },
      { name: "max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "good_max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "warn_max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "decimals", selector: { number: { min: 0, max: 3, step: 1, mode: "box" } } },
      { name: "unit_fallback", selector: { text: {} } },
      { name: "label_good", selector: { text: {} } },
      { name: "label_warn", selector: { text: {} } },
      { name: "label_bad", selector: { text: {} } },
    ];

    const bandedSchema = (min, max, step = 1) => [
      { name: "offset", selector: { number: { min: -500, max: 500, step, mode: "box" } } },
      { name: "min", selector: { number: { min, max, step, mode: "box" } } },
      { name: "max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "fair_min", selector: { number: { min, max, step, mode: "box" } } },
      { name: "good_min", selector: { number: { min, max, step, mode: "box" } } },
      { name: "good_max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "fair_max", selector: { number: { min, max, step, mode: "box" } } },
      { name: "decimals", selector: { number: { min: 0, max: 3, step: 1, mode: "box" } } },
      { name: "unit_fallback", selector: { text: {} } },
      { name: "label_good", selector: { text: {} } },
      { name: "label_fair", selector: { text: {} } },
      { name: "label_bad", selector: { text: {} } },
    ];

    return {
      schema: [
        // BASE
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
          ],
        },

        // GRAPH
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

        // ASCENDING
        { type: "expandable", name: "radon", title: "Seuils Radon (ascendant)", schema: ascendingSchema(0, 5000, 1) },
        { type: "expandable", name: "voc", title: "Seuils COV / TVOC (ascendant)", schema: ascendingSchema(0, 20000, 1) },
        { type: "expandable", name: "pm1", title: "Seuils PM1 (ascendant)", schema: ascendingSchema(0, 500, 0.1) },
        { type: "expandable", name: "pm25", title: "Seuils PM2.5 (ascendant)", schema: ascendingSchema(0, 500, 0.1) },

        // BANDED
        { type: "expandable", name: "pressure", title: "Seuils Pression (rouge/orange/vert/orange/rouge)", schema: bandedSchema(800, 1100, 1) },
        { type: "expandable", name: "humidity", title: "Seuils Humidité (rouge/orange/vert/orange/rouge)", schema: bandedSchema(0, 100, 1) },
        { type: "expandable", name: "temperature", title: "Seuils Température (rouge/orange/vert/orange/rouge)", schema: bandedSchema(-50, 80, 0.5) },

        // ADVANCED
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
          hours_to_show: "Heures affichées",
          graph_height: "Hauteur graphe",
          line_width: "Épaisseur ligne",

          offset: "Offset",
          min: "Min",
          max: "Max",
          decimals: "Décimales",
          unit_fallback: "Unité (fallback)",

          // ascending
          good_max: "Vert ≤",
          warn_max: "Orange ≤",
          label_good: "Label vert",
          label_warn: "Label orange",
          label_bad: "Label rouge",

          // banded
          fair_min: "Orange min",
          good_min: "Vert min",
          fair_max: "Orange max",
          label_fair: "Label orange",

          secondary: "Secondary (template)",
          color: "Color (template)",
          mushroom: "Override mushroom (YAML)",
          graph: "Override graph (YAML)",
          name_by_preset: "Override noms (par preset)",
          icon_by_preset: "Override icônes (par preset)",
        };

        const bandedKeys = ["pressure", "humidity", "temperature"];
        if (schema.name === "good_max" && bandedKeys.includes(schema.path?.[0])) return "Vert max";

        return map[schema.name];
      },

      computeHelper: (schema) => {
        switch (schema.name) {
          case "preset":
            return "Choisis le type de capteur (radon / pression / humidité / température / COV / PM).";
          case "offset":
            return "Ex: pression au niveau mer = valeur + offset.";
          case "secondary":
            return "Si rempli, remplace le texte secondaire généré par le preset.";
          case "color":
            return "Si rempli, remplace la couleur (green/orange/red/disabled) générée par le preset.";
          case "mushroom":
            return "Objet YAML fusionné dans la mushroom-template-card (tap_action, hold_action, etc.).";
          case "graph":
            return "Objet YAML fusionné dans mini-graph-card (points_per_hour, smoothing, etc.).";
          case "name_by_preset":
            return "Objet YAML: ex { pm25: 'PM2.5 Salon', voc: 'TVOC Couloir' }";
          case "icon_by_preset":
            return "Objet YAML: ex { pm25: 'mdi:blur', voc: 'mdi:air-filter' }";
          case "decimals":
            return "Nombre de décimales affichées dans le secondary.";
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

      // Global mapping overrides
      name_by_preset: {},
      icon_by_preset: {},

      // ASCENDING (vert -> orange -> rouge)
      radon: {
        offset: 0,
        min: 0,
        max: 300,
        good_max: 99,
        warn_max: 149,
        decimals: 1,
        unit_fallback: "Bq/m³",
        label_good: "Bon",
        label_warn: "Moyen",
        label_bad: "Mauvais",
      },
      voc: {
        offset: 0,
        min: 0,
        max: 3000,
        good_max: 250,
        warn_max: 2000,
        decimals: 0,
        unit_fallback: "ppb",
        label_good: "Faible",
        label_warn: "À ventiler",
        label_bad: "Très élevé",
      },
      pm1: {
        offset: 0,
        min: 0,
        max: 100,
        good_max: 10,
        warn_max: 25,
        decimals: 1,
        unit_fallback: "µg/m³",
        label_good: "Bon",
        label_warn: "Moyen",
        label_bad: "Mauvais",
      },
      pm25: {
        offset: 0,
        min: 0,
        max: 150,
        good_max: 12.0,
        warn_max: 35.4,
        decimals: 1,
        unit_fallback: "µg/m³",
        label_good: "Bon",
        label_warn: "Moyen",
        label_bad: "Mauvais",
      },

      // BANDED (rouge/orange/vert/orange/rouge)
      pressure: {
        offset: 27,
        min: 970,
        max: 1050,
        fair_min: 995,
        good_min: 1005,
        good_max: 1025,
        fair_max: 1035,
        decimals: 0,
        unit_fallback: "hPa",
        label_good: "Normal",
        label_fair: "Variable",
        label_bad: "Extrême",
      },
      humidity: {
        offset: 0,
        min: 0,
        max: 100,
        fair_min: 30,
        good_min: 40,
        good_max: 60,
        fair_max: 70,
        decimals: 0,
        unit_fallback: "%",
        label_good: "Confort",
        label_fair: "Ok",
        label_bad: "Inconfort",
      },
      temperature: {
        offset: 0,
        min: 0,
        max: 35,
        fair_min: 17,
        good_min: 19,
        good_max: 23,
        fair_max: 26,
        decimals: 1,
        unit_fallback: "°C",
        label_good: "Confort",
        label_fair: "Ok",
        label_bad: "Alerte",
      },

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
  }

  getCardSize() {
    return this._config?.show_graph ? 3 : 2;
  }

  async _getHelpers() {
    if (!this._helpersPromise) this._helpersPromise = window.loadCardHelpers();
    return this._helpersPromise;
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

  _barStyleAscending() {
    const p = this._ascendingParams();
    const min = Number(p.min), max = Number(p.max);
    const goodMax = Number(p.good_max), warnMax = Number(p.warn_max);
    const off = Number(p.offset || 0);

    const goodPct = ((goodMax - min) / (max - min)) * 100;
    const warnPct = ((warnMax - min) / (max - min)) * 100;

    return `
ha-card{
  box-shadow:none;
  border-radius:0;
  background:none;

  position:relative;
  overflow:hidden;
  padding-bottom:14px;

  {% set v = states(config.entity) | float(none) %}
  {% set off = ${off} %}
  {% set sl = (v + off) if v is not none else none %}

  --p: {% if sl is none %}0{% else %}
       {% set p = ((sl - ${min}) / (${max} - ${min}) * 100) %}
       {{ [0, [p, 100] | min] | max }}
       {% endif %};
  --thumb_opacity: {% if sl is none %}0{% else %}1{% endif %};

  --fill: {% if sl is none %} rgba(180,190,200,0.55)
         {% elif sl <= ${goodMax} %} rgba(69,213,142,0.95)
         {% elif sl <= ${warnMax} %} rgba(255,183,77,0.95)
         {% else %} rgba(255,99,99,0.95)
         {% endif %};

  --track: linear-gradient(90deg,
    rgba(69,213,142,0.30) 0%,
    rgba(69,213,142,0.30) ${goodPct.toFixed(2)}%,
    rgba(255,183,77,0.30) ${goodPct.toFixed(2)}%,
    rgba(255,183,77,0.30) ${warnPct.toFixed(2)}%,
    rgba(255,99,99,0.30)  ${warnPct.toFixed(2)}%,
    rgba(255,99,99,0.30)  100%
  );
}
ha-card:before{
  content:"";
  position:absolute;
  left:16px; right:16px;
  bottom:8px;
  height:6px;
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(16px + (100% - 32px) * (var(--p) / 100));
  bottom: 6px;
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

    return `
ha-card{
  box-shadow:none;
  border-radius:0;
  background:none;

  position: relative;
  overflow: hidden;
  padding-bottom: 14px;

  {% set v = states(config.entity) | float(none) %}
  {% set off = ${off} %}
  {% set sl = (v + off) if v is not none else none %}

  --p: {% if sl is none %}0{% else %}
       {% set p = ((sl - ${min}) / (${max} - ${min}) * 100) %}
       {{ [0, [p, 100] | min] | max }}
       {% endif %};
  --thumb_opacity: {% if sl is none %}0{% else %}1{% endif %};

  --fill: {% if sl is none %} rgba(180,190,200,0.55)
         {% elif ${goodMin} <= sl <= ${goodMax} %} rgba(69,213,142,0.95)
         {% elif ${fairMin} <= sl <= ${fairMax} %} rgba(255,183,77,0.95)
         {% else %} rgba(255,99,99,0.95)
         {% endif %};

  --p_fmin: {{ ((${fairMin}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_gmin: {{ ((${goodMin}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_gmax: {{ ((${goodMax}-${min})/(${max}-${min})*100) | round(2) }}%;
  --p_fmax: {{ ((${fairMax}-${min})/(${max}-${min})*100) | round(2) }}%;

  --track: linear-gradient(90deg,
    rgba(255,99,99,0.30) 0%,
    rgba(255,99,99,0.30) var(--p_fmin),
    rgba(255,183,77,0.30) var(--p_fmin),
    rgba(255,183,77,0.30) var(--p_gmin),
    rgba(69,213,142,0.30) var(--p_gmin),
    rgba(69,213,142,0.30) var(--p_gmax),
    rgba(255,183,77,0.30) var(--p_gmax),
    rgba(255,183,77,0.30) var(--p_fmax),
    rgba(255,99,99,0.30)  var(--p_fmax),
    rgba(255,99,99,0.30)  100%
  );
}
ha-card:before{
  content:"";
  position:absolute;
  left:16px; right:16px;
  bottom:8px;
  height:6px;
  border-radius:999px;
  background: var(--track);
}
ha-card:after{
  content:"";
  position:absolute;
  left: calc(16px + (100% - 32px) * (var(--p) / 100));
  bottom: 6px;
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
      (this._isAscendingPreset() ? this._secondaryTemplateAscending() : this._secondaryTemplateBanded());

    const color =
      this._config.color ??
      (this._isAscendingPreset() ? this._colorTemplateAscending() : this._colorTemplateBanded());

    const barStyle = this._isAscendingPreset() ? this._barStyleAscending() : this._barStyleBanded();

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
    }

    if (this._hass) this.hass = this._hass;
  }
}

customElements.define(CARD_TYPE, Jp2AirQualityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: CARD_NAME,
  description: CARD_DESC,
});

console.info(
  `%c ${CARD_NAME} %c v${"1.5.1"} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
