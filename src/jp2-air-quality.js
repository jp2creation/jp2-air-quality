
/*
  JP2 Air Quality Card
  File name must remain: jp2-air-quality.js

  Release notes — v2.0.3
  - Ref: refonte totale de l’éditeur visuel (UI fluide + navigation par onglets + aperçu IQA + overrides).
  - Ref: code restructuré (helpers centralisés, rendu éditeur sans reflow inutile).
  - Fix: optimisation IQA (clé de rendu basée sur last_changed, throttling rAF).
  - Fix: correction d’un bloc de code erroné dans l’éditeur (Safari iOS / mobile).
*/

const CARD_TYPE = "jp2-air-quality";
const CARD_NAME = "JP2 Air Quality";
const CARD_DESC = "Air quality card (sensor + IQA multi-sensors) with internal history graph and a fluid visual editor (v2).";
const CARD_VERSION = "2.0.3";

// -------------------------
// Defaults / presets
// -------------------------
const DEFAULT_NAME_BY_PRESET = {
  radon: "Radon",
  pressure: "Pression",
  humidity: "Humidité",
  temperature: "Température",
  voc: "COV / TVOC",
  pm1: "PM1",
  pm25: "PM2.5",
  co2: "CO₂",
};

const DEFAULT_ICON_BY_PRESET = {
  radon: "mdi:radioactive",
  pressure: "mdi:gauge",
  humidity: "mdi:water-percent",
  temperature: "mdi:thermometer",
  voc: "mdi:air-filter",
  pm1: "mdi:weather-hazy",
  pm25: "mdi:weather-hazy",
  co2: "mdi:molecule-co2",
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isNum(n) {
  return typeof n === "number" && !Number.isNaN(n) && Number.isFinite(n);
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const _JP2_UA = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
const _JP2_IS_SAFARI = /Safari/i.test(_JP2_UA) && !/(Chrome|Chromium|Edg|OPR)/i.test(_JP2_UA);
const _JP2_SUPPORTS_COLOR_MIX = !_JP2_IS_SAFARI && (typeof CSS !== "undefined") && CSS.supports && CSS.supports("color", "color-mix(in srgb, #000 10%, transparent)");

function cssColorMix(color, pct) {
  const p = clamp(pct, 0, 100);
  if (_JP2_SUPPORTS_COLOR_MIX) return `color-mix(in srgb, ${color} ${p}%, transparent)`;
  // Fallback léger (évite certains gels WebKit). Si la couleur est un hex, on génère un rgba.
  const c = String(color || "").trim();
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(c);
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(c);
  let r=null,g=null,b=null;
  if (m3) {
    const h = m3[1];
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (m6) {
    const h = m6[1];
    r = parseInt(h.slice(0,2), 16);
    g = parseInt(h.slice(2,4), 16);
    b = parseInt(h.slice(4,6), 16);
  }
  if (r !== null) {
    const a = Math.max(0, Math.min(1, p / 100));
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return "transparent";
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function _jp2EscapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") {
      e.className = v;
      continue;
    }

    if (k === "style") {
      if (v && typeof v === "object") {
        // Supporte les variables CSS et les propriétés kebab-case (ex: --my-var, background-color)
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          const val = String(sv);
          if (sk.startsWith("--") || sk.includes("-")) e.style.setProperty(sk, val);
          else e.style[sk] = val;
        }
      } else if (v !== undefined && v !== null) {
        e.setAttribute("style", String(v));
      }
      continue;
    }

    if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2), v);
      continue;
    }

    if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  }

  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}


// -------------------------
// Card
// -------------------------
class Jp2AirQualityCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;

    this._root = null;
    this._header = null;
    this._graphWrap = null;
    this._iqaWrap = null;

    this._historyCache = new Map(); // key -> { ts, points }
    this._historyInflight = new Map(); // key -> promise

    this._lastRenderKey = null; // évite les re-renders inutiles
    this._renderRaf = null; // throttling rAF
  }

  static getStubConfig() {
    return {
      card_mode: "sensor", // sensor | iqa

      // sensor card
      entity: "",
      preset: "radon",
      name: DEFAULT_NAME_BY_PRESET.radon,
      icon: DEFAULT_ICON_BY_PRESET.radon,
      background_enabled: false,
      bar_enabled: true,
      show_graph: true,

      // display (sensor)
      show_top: true,
      show_title: true,
      show_secondary: true,
      show_secondary_value: true,
      show_secondary_unit: true,
      show_secondary_state: true,
      show_icon: true,
      show_value: true,
      show_unit: true,
      show_knob: true,
      knob_size: 12,
      knob_outline: true,
      knob_shadow: true,

      // icon (sensor)
      icon_size: 40,
      icon_inner_size: 22,
      icon_background: true,
      icon_circle: true,

      // typography (sensor)
      title_size: 16,
      value_size: 18,
      unit_size: 12,
      secondary_value_size: 12,
      secondary_unit_size: 12,
      secondary_state_size: 12,

      // internal graph (sensor)
      graph_position: "below_top", // below_top | inside_top | top | bottom
      hours_to_show: 24,
      graph_height: 42,
      line_width: 2,
      graph_color_mode: "segments", // single | peaks | segments
      graph_color: "",
      graph_warn_color: "",
      graph_bad_color: "",

      // thresholds bar colors
      bar: {
        align: "center",
        width: 92,
        height: 6,
        good: "#45d58e",
        warn: "#ffb74d",
        bad: "#ff6363",
      },

      // IQA card
      iqa_title: "IQA",
      iqa_title_left_image: "",
      iqa_title_left_image_size: 22,
      iqa_title_left_icon: "",
      iqa_title_left_icon_size: 20,
      iqa_entities: [],
      iqa_show_title: true,
      iqa_show_global: true,
      iqa_show_sensors: true,

      iqa_background_enabled: false,
      iqa_layout: "vertical", // vertical | horizontal
      iqa_horizontal_icons_only: false,
      // Horizontal tiles options
      iqa_tiles_per_row: 3,
      iqa_tile_color_enabled: false,
      iqa_tile_radius: 16,

      // per-sensor row elements
      iqa_show_sensor_icon: true,
      iqa_show_sensor_name: true,
      iqa_show_sensor_entity: false,
      iqa_show_sensor_value: true,
      iqa_show_sensor_unit: true,
      iqa_show_sensor_status: true,

      // IQA icon defaults + global style
      iqa_icon_size: 34,
      iqa_icon_inner_size: 18,
      iqa_icon_background: true,
      iqa_icon_circle: true,

      // Per-entity overrides: { "sensor.xxx": { icon, icon_size, icon_inner_size } }
      iqa_overrides: {},
    };
  }

  static getConfigElement() {
    return document.createElement("jp2-air-quality-editor");
  }

  static getConfigForm(config = {}) {
    const c = { ...Jp2AirQualityCard.getStubConfig(), ...(config || {}) };
    const mode = String(c.card_mode || "sensor");
    const isIqa = mode === "iqa";

    const cardTypeOptions = [
      { label: "Capteur Card", value: "sensor" },
      { label: "IQA Card (multi-capteurs)", value: "iqa" },
    ];

    const presetOptions = [
      { label: "Radon", value: "radon" },
      { label: "Pression", value: "pressure" },
      { label: "Humidité", value: "humidity" },
      { label: "Température", value: "temperature" },
      { label: "COV / TVOC", value: "voc" },
      { label: "PM1", value: "pm1" },
      { label: "PM2.5", value: "pm25" },
      { label: "CO₂", value: "co2" },
    ];

    const graphPosOptions = [
      { label: "Sous l'en-tête", value: "below_top" },
      { label: "Dans l'en-tête (sous la barre)", value: "inside_top" },
      { label: "En haut", value: "top" },
      { label: "En bas", value: "bottom" },
    ];

    const graphColorModeOptions = [
      { label: "Couleur unique", value: "single" },
      { label: "Pics orange/rouge", value: "peaks" },
      { label: "Segments orange/rouge", value: "segments" },
    ];

    // SENSOR schema
    const sensorSchema = [
      {
        type: "grid",
        name: "",
        flatten: true,
        column_min_width: "240px",
        schema: [
          { name: "card_mode", selector: { select: { options: cardTypeOptions, mode: "dropdown" } } },
          { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
          { name: "preset", selector: { select: { options: presetOptions, mode: "dropdown" } } },
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
        ],
      },
      {
        type: "expandable",
        name: "sensor_display",
        title: "Affichage (Capteur Card)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "background_enabled", selector: { boolean: {} } },
              { name: "bar_enabled", selector: { boolean: {} } },
              { name: "show_graph", selector: { boolean: {} } },
              { name: "show_title", selector: { boolean: {} } },
              { name: "show_secondary", selector: { boolean: {} } },
              { name: "show_secondary_value", selector: { boolean: {} } },
              { name: "show_secondary_unit", selector: { boolean: {} } },
              { name: "show_secondary_state", selector: { boolean: {} } },
              { name: "show_icon", selector: { boolean: {} } },
              { name: "show_value", selector: { boolean: {} } },
              { name: "show_unit", selector: { boolean: {} } },
              { name: "show_knob", selector: { boolean: {} } },
            ],
          },
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "knob_size", selector: { number: { min: 6, max: 28, mode: "box", step: 1 } } },
              { name: "knob_outline", selector: { boolean: {} } },
              { name: "knob_shadow", selector: { boolean: {} } },
            ],
          },
        ],
      },
      {
        type: "expandable",
        name: "sensor_icon",
        title: "Icône (Capteur Card)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "icon_size", selector: { number: { min: 16, max: 90, mode: "box", step: 1 } } },
              { name: "icon_inner_size", selector: { number: { min: 10, max: 70, mode: "box", step: 1 } } },
              { name: "icon_background", selector: { boolean: {} } },
              { name: "icon_circle", selector: { boolean: {} } },
            ],
          },
        ],
      },
      {
        type: "expandable",
        name: "sensor_typo",
        title: "Tailles (Capteur Card)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "title_size", selector: { number: { min: 10, max: 36, mode: "box", step: 1 } } },
              { name: "value_size", selector: { number: { min: 10, max: 48, mode: "box", step: 1 } } },
              { name: "unit_size", selector: { number: { min: 8, max: 30, mode: "box", step: 1 } } },
              { name: "secondary_value_size", selector: { number: { min: 8, max: 30, mode: "box", step: 1 } } },
              { name: "secondary_unit_size", selector: { number: { min: 8, max: 30, mode: "box", step: 1 } } },
              { name: "secondary_state_size", selector: { number: { min: 8, max: 30, mode: "box", step: 1 } } },
            ],
          },
        ],
      },
      {
        type: "expandable",
        name: "graph",
        title: "Graphe interne (historique Home Assistant)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "graph_position", selector: { select: { options: graphPosOptions, mode: "dropdown" } } },
              { name: "hours_to_show", selector: { number: { min: 1, max: 168, mode: "box", step: 1 } } },
              { name: "graph_height", selector: { number: { min: 12, max: 220, mode: "box", step: 1 } } },
              { name: "line_width", selector: { number: { min: 1, max: 8, mode: "box", step: 1 } } },
              { name: "graph_color_mode", selector: { select: { options: graphColorModeOptions, mode: "dropdown" } } },
              { name: "graph_color", selector: { text: {} } },
              { name: "graph_warn_color", selector: { text: {} } },
              { name: "graph_bad_color", selector: { text: {} } },
            ],
          },
        ],
      },
      {
        type: "expandable",
        name: "bar",
        title: "Couleurs (Bon / Moyen / Mauvais)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "good", selector: { text: {} }, path: "bar" },
              { name: "warn", selector: { text: {} }, path: "bar" },
              { name: "bad", selector: { text: {} }, path: "bar" },
              { name: "width", selector: { number: { min: 50, max: 100, mode: "box", step: 1 } }, path: "bar" },
              { name: "height", selector: { number: { min: 4, max: 18, mode: "box", step: 1 } }, path: "bar" },
              { name: "align", selector: { select: { options: [
                { label: "Centré", value: "center" },
                { label: "Gauche", value: "left" },
                { label: "Droite", value: "right" },
              ], mode: "dropdown" } }, path: "bar" },
            ],
          },
        ],
      },
    ];

    // IQA schema minimal (advanced in custom UI)
    const iqaSchema = [
      {
        type: "grid",
        name: "",
        flatten: true,
        column_min_width: "240px",
        schema: [
          { name: "card_mode", selector: { select: { options: cardTypeOptions, mode: "dropdown" } } },
          { name: "iqa_title", selector: { text: {} } },
          { name: "iqa_entities", required: true, selector: { entity: { multiple: true, domain: "sensor" } } },
        ],
      },
      {
        type: "expandable",
        name: "iqa_basic",
        title: "IQA — Options principales",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "iqa_show_title", selector: { boolean: {} } },
              { name: "iqa_show_global", selector: { boolean: {} } },
              { name: "iqa_show_sensors", selector: { boolean: {} } },
              { name: "iqa_background_enabled", selector: { boolean: {} } },
            ],
          },
        ],
      },
      {
        type: "expandable",
        name: "colors",
        title: "Couleurs (Bon / Moyen / Mauvais)",
        flatten: true,
        schema: [
          {
            type: "grid",
            name: "",
            flatten: true,
            column_min_width: "240px",
            schema: [
              { name: "good", selector: { text: {} }, path: "bar" },
              { name: "warn", selector: { text: {} }, path: "bar" },
              { name: "bad", selector: { text: {} }, path: "bar" },
            ],
          },
        ],
      },
    ];

    const schema = isIqa ? iqaSchema : sensorSchema;

    const labelMap = {
      card_mode: "Type de carte",
      entity: "Capteur",
      preset: "Preset",
      name: "Nom",
      icon: "Icône",
      background_enabled: "Fond coloré",
      bar_enabled: "Afficher la barre",
      show_graph: "Afficher le graphe",
      graph_position: "Position du graphe",
      hours_to_show: "Heures affichées",
      graph_height: "Hauteur graphe",
      line_width: "Épaisseur ligne",
      graph_color_mode: "Mode couleur graphe",
      graph_color: "Couleur graphe",
      graph_warn_color: "Couleur orange (warn)",
      graph_bad_color: "Couleur rouge (bad)",
      show_title: "Afficher le titre",
      show_secondary: "Afficher les attributs (ligne 2)",
      show_secondary_value: "Ligne 2 : valeur",
      show_secondary_unit: "Ligne 2 : unité",
      show_secondary_state: "Ligne 2 : état",
      show_icon: "Afficher l'icône",
      show_value: "Afficher la valeur (droite)",
      show_unit: "Afficher l'unité (droite)",
      show_knob: "Afficher l'indicateur",
      knob_size: "Taille indicateur (px)",
      knob_outline: "Contour indicateur",
      knob_shadow: "Ombre indicateur",
      icon_size: "Taille icône (cercle)",
      icon_inner_size: "Taille pictogramme",
      icon_background: "Fond icône",
      icon_circle: "Cercle icône",
      title_size: "Taille titre",
      value_size: "Taille valeur (droite)",
      unit_size: "Taille unité (droite)",
      secondary_value_size: "Taille ligne2 valeur",
      secondary_unit_size: "Taille ligne2 unité",
      secondary_state_size: "Taille ligne2 état",
      good: "Couleur vert",
      warn: "Couleur orange",
      bad: "Couleur rouge",
      width: "Largeur (%)",
      height: "Hauteur (px)",
      align: "Alignement",
      iqa_title: "Titre IQA",
      iqa_title_left_image: "Image à gauche du titre",
      iqa_title_left_image_size: "Taille image titre (px)",
      iqa_title_left_icon: "Icône à gauche du titre",
      iqa_title_left_icon_size: "Taille icône titre (px)",
      iqa_title_left_image: "Image à gauche du titre",
      iqa_title_left_image_size: "Taille image titre (px)",
      iqa_title_left_icon: "Icône à gauche du titre",
      iqa_title_left_icon_size: "Taille icône titre (px)",
      iqa_entities: "Entités IQA",
      iqa_show_title: "Afficher le titre",
      iqa_show_global: "Afficher le statut global",
      iqa_show_sensors: "Afficher la liste des capteurs",
      iqa_background_enabled: "Fond coloré (IQA)",
      iqa_horizontal_icons_only: "Horizontal : icônes uniquement",
    };

    const helperMap = {
      iqa_entities: "Ajoute plusieurs capteurs (CO₂, VOC/TVOC, PM2.5, Radon...). Un statut Bon/Moyen/Mauvais est calculé pour chacun.",
      graph_color: "Ex: var(--primary-color) ou #00bcd4. Vide = couleur du thème.",
      graph_warn_color: "Vide = couleur orange de la barre.",
      graph_bad_color: "Vide = couleur rouge de la barre.",
    };

    return {
      schema,
      computeLabel: (s) => labelMap[s.name] || s.name,
      computeHelper: (s) => helperMap[s.name] || "",
    };
  }

  setConfig(config) {
    const stub = Jp2AirQualityCard.getStubConfig();
    const merged = {
      ...stub,
      ...deepClone(config || {}),
      bar: { ...(stub.bar || {}), ...deepClone((config && config.bar) || {}) },
    };

    merged.card_mode = String(merged.card_mode || "sensor");
    merged.preset = String(merged.preset || "radon");
    merged.graph_color_mode = String(merged.graph_color_mode || "segments");
    merged.graph_position = String(merged.graph_position || "below_top");
    merged.iqa_layout = String(merged.iqa_layout || "vertical");

    merged.iqa_entities = Array.isArray(merged.iqa_entities) ? merged.iqa_entities : [];
    merged.iqa_overrides = merged.iqa_overrides && typeof merged.iqa_overrides === "object" ? merged.iqa_overrides : {};

    merged.iqa_tiles_per_row = clamp(Number(merged.iqa_tiles_per_row || 3), 1, 6);
    merged.iqa_tile_radius = clamp(Number(merged.iqa_tile_radius ?? 16), 0, 40);

    if (!merged.name) merged.name = DEFAULT_NAME_BY_PRESET[merged.preset] || "Capteur";
    if (!merged.icon) merged.icon = DEFAULT_ICON_BY_PRESET[merged.preset] || "mdi:information";

    this._config = merged;
    this._lastRenderKey = null;
    this._ensureBase();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._ensureBase();

    const mode = String(this._config.card_mode || "sensor");
    const key = mode === "iqa" ? this._buildIqaKey(hass) : this._buildSensorKey(hass);
    if (key && key === this._lastRenderKey) return;
    this._lastRenderKey = key;

    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderRaf) cancelAnimationFrame(this._renderRaf);
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = null;
      this._render();
    });
  }

  getCardSize() {
    return 3;
  }


  _showError(title, err) {
    const msg = err && (err.message || err.toString()) ? (err.message || err.toString()) : String(err || "");
    // Log complet pour debug
    try { console.error(`[${CARD_NAME}] ${title}`, err); } catch (_) {}

    // Réinitialise la vue pour afficher une erreur lisible au lieu d'une carte vide
    try {
      this._root = null;
      this._header = null;
      this._graphWrap = null;
      this._iqaWrap = null;
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding:12px">
            <div style="font-weight:700; color: var(--error-color, #d32f2f);">JP2 Air Quality — ${_jp2EscapeHtml(title)}</div>
            <div style="margin-top:6px; font-size:12px; opacity:.85;">${_jp2EscapeHtml(msg)}</div>
            <div style="margin-top:6px; font-size:12px; opacity:.65;">Ouvre la console (F12) pour les détails, puis envoie-moi le message d'erreur.</div>
          </div>
        </ha-card>
      `;
    } catch (_) {
      // Dernier recours
    }
  }

  _buildSensorKey(hass) {
    const c = this._config;
    const eid = c?.entity;
    if (!eid) return "sensor:none";
    const st = hass?.states?.[eid];
    if (!st) return `sensor:${eid}:missing`;
    return `sensor:${eid}:${st.state}:${st.last_changed || ""}`;
  }

  _buildIqaKey(hass) {
    const c = this._config;
    const ents = Array.isArray(c?.iqa_entities) ? c.iqa_entities : [];
    const cfgBits = [
      String(c?.iqa_layout || "vertical"),
      String(c?.iqa_tiles_per_row || ""),
      String(c?.iqa_tile_radius || ""),
      String(!!c?.iqa_tile_color_enabled),
      String(!!c?.iqa_show_sensors),
      String(!!c?.iqa_show_global),
      String(!!c?.iqa_show_title),
      String(!!c?.iqa_show_sensor_icon),
      String(!!c?.iqa_show_sensor_name),
      String(!!c?.iqa_show_sensor_entity),
      String(!!c?.iqa_show_sensor_value),
      String(!!c?.iqa_show_sensor_unit),
      String(!!c?.iqa_show_sensor_status),
    ].join("|");

    const parts = [`iqa:${cfgBits}`];
    for (const eid of ents) {
      const st = hass?.states?.[eid];
      if (!st) {
        parts.push(`${eid}:missing`);
        continue;
      }
      const u = st.attributes?.unit_of_measurement || "";
      parts.push(`${eid}:${st.state}:${u}:${st.last_changed || ""}`);
    }
    return parts.join(";");
  }


  _presetConfig(preset) {
    const p = String(preset || "radon");
    const common = { decimals: 0, unit_fallback: "", min: 0, max: 100, good_max: 0, warn_max: 0, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" };
    const map = {
      radon: { ...common, decimals: 0, unit_fallback: "Bq/m³", min: 0, max: 300, good_max: 99, warn_max: 149, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      voc: { ...common, decimals: 0, unit_fallback: "ppb", min: 0, max: 3000, good_max: 250, warn_max: 2000, label_good: "Faible", label_warn: "À ventiler", label_bad: "Très élevé" },
      pm1: { ...common, decimals: 1, unit_fallback: "µg/m³", min: 0, max: 100, good_max: 10, warn_max: 25, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      pm25: { ...common, decimals: 1, unit_fallback: "µg/m³", min: 0, max: 150, good_max: 12.0, warn_max: 35.4, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      co2: { ...common, decimals: 0, unit_fallback: "ppm", min: 400, max: 2000, good_max: 800, warn_max: 1200, label_good: "Bon", label_warn: "À aérer", label_bad: "Élevé" },
      temperature: { ...common, decimals: 1, unit_fallback: "°C", min: 0, max: 35, good_max: 23, warn_max: 26, label_good: "Confort", label_warn: "À surveiller", label_bad: "Alerte" },
      humidity: { ...common, decimals: 0, unit_fallback: "%", min: 0, max: 100, good_max: 60, warn_max: 70, label_good: "Confort", label_warn: "À surveiller", label_bad: "Inconfort" },
      pressure: { ...common, decimals: 0, unit_fallback: "hPa", min: 970, max: 1050, good_max: 1025, warn_max: 1035, label_good: "Normal", label_warn: "Variable", label_bad: "Extrême" },
    };
    return map[p] || map.radon;
  }

  _colors() {
    const bar = this._config?.bar || {};
    return {
      good: bar.good || "#45d58e",
      warn: bar.warn || "#ffb74d",
      bad: bar.bad || "#ff6363",
    };
  }

  _statusFor(preset, value) {
    const pc = this._presetConfig(preset);
    const colors = this._colors();
    const v = toNum(value);
    if (v === null) {
      return { level: "unknown", label: "—", color: "var(--secondary-text-color)", ratio: 0 };
    }
    let level = "bad";
    let label = pc.label_bad;
    let color = colors.bad;
    if (v <= pc.good_max) {
      level = "good";
      label = pc.label_good;
      color = colors.good;
    } else if (v <= pc.warn_max) {
      level = "warn";
      label = pc.label_warn;
      color = colors.warn;
    }
    const ratio = pc.max > pc.min ? clamp((v - pc.min) / (pc.max - pc.min), 0, 1) : 0;
    return { level, label, color, ratio, preset: String(preset) };
  }

  _detectPreset(entityId, stateObj) {
    const id = String(entityId || "").toLowerCase();
    const unit = String(stateObj?.attributes?.unit_of_measurement || "").toLowerCase();
    const dc = String(stateObj?.attributes?.device_class || "").toLowerCase();
    if (dc.includes("carbon_dioxide") || id.includes("co2") || unit === "ppm") return "co2";
    if (dc.includes("volatile") || id.includes("tvoc") || id.includes("voc") || unit === "ppb") return "voc";
    if (id.includes("pm2") || id.includes("pm25") || id.includes("pm_2_5")) return "pm25";
    if (id.includes("pm1")) return "pm1";
    if (id.includes("radon") || unit.includes("bq")) return "radon";
    if (unit.includes("µg") || unit.includes("ug")) return "pm25";
    return "co2";
  }

  _ensureBase() {
    if (this._root) return;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { padding: 12px; }
        .wrap { display:flex; flex-direction:column; gap: 10px; }

        .header { display:flex; align-items:center; gap: 12px; }
        .header.hidden { display:none; }
        .icon-wrap { width: var(--jp2-icon-size, 40px); height: var(--jp2-icon-size, 40px); display:flex; align-items:center; justify-content:center; flex: 0 0 auto; position:relative; }
        .icon-bg { position:absolute; inset:0; border-radius:999px; opacity: .12; background: var(--jp2-status-color, var(--primary-color)); }
        .icon-circle { position:absolute; inset:0; border-radius:999px; border: 1px solid var(--jp2-status-outline, var(--divider-color, rgba(0,0,0,.12))); }
        ha-icon { --mdc-icon-size: var(--jp2-icon-inner-size, 22px); color: var(--jp2-status-color, var(--primary-text-color)); }

        .title-area { min-width: 0; flex: 1 1 auto; }
        .title { font-weight: 700; font-size: var(--jp2-title-size, 16px); line-height: 1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .secondary { margin-top: 2px; opacity: .75; font-size: 12px; display:flex; gap:6px; flex-wrap:wrap; align-items:baseline;}
        .secondary .sv { font-size: var(--jp2-secondary-value-size, 12px); }
        .secondary .su { font-size: var(--jp2-secondary-unit-size, 12px); }
        .secondary .ss { font-size: var(--jp2-secondary-state-size, 12px); font-weight:600; }

        .value-area { text-align:right; flex: 0 0 auto; }
        .value { font-weight: 700; font-size: var(--jp2-value-size, 18px); line-height: 1; }
        .unit { opacity:.75; font-size: var(--jp2-unit-size, 12px); margin-top: 2px; }

        .bar-wrap { display:flex; align-items:center; justify-content:center; }
        .bar-wrap.left { justify-content:flex-start; }
        .bar-wrap.right { justify-content:flex-end; }
        .bar { width: var(--jp2-bar-width, 92%); height: var(--jp2-bar-height, 6px); border-radius: 999px; overflow: hidden; position: relative; background: var(--divider-color, rgba(0,0,0,.12)); }
        .bar .seg { height:100%; width:33.333%; float:left; }
        .bar .seg.good { background: var(--jp2-good); }
        .bar .seg.warn { background: var(--jp2-warn); }
        .bar .seg.bad { background: var(--jp2-bad); }

        .knob { position:absolute; top: 50%; transform: translate(-50%, -50%); width: var(--jp2-knob-size, 12px); height: var(--jp2-knob-size, 12px); border-radius:999px; background: var(--jp2-status-color, var(--primary-color)); }
        .knob.outline { box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 2px rgba(0,0,0,.25); }
        .knob.shadow { filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }

        .graph { display:none; }
        .graph.show { display:block; }
        .graph svg { width: 100%; height: var(--jp2-graph-height, 42px); display:block; }
        .graph .msg { font-size: 12px; opacity: .7; padding: 6px 0 0; }

        .iqa { display:none; }
        .iqa.show { display:block; }
        .iqa-head { display:flex; align-items:baseline; justify-content:space-between; gap: 10px; }
        .iqa-title { font-weight: 800; }
        
        .iqa-title.with-prefix { display:flex; align-items:center; gap: 10px; }
        .iqa-title-left { display:inline-flex; align-items:center; gap: 8px; }
        .iqa-title-img { display:block; }
        .iqa-title-ico { display:block; }
.iqa-global { font-weight: 700; opacity:.85; display:flex; gap:8px; align-items:center; }
        .dot { width:10px; height:10px; border-radius:999px; background: var(--jp2-status-color); box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 2px rgba(0,0,0,.20); }

        .iqa-list { display:flex; flex-direction:column; gap: 8px; margin-top: 8px; }
        .iqa-row { display:flex; align-items:center; gap: 10px; padding: 8px 10px; border-radius: 14px; background: var(--secondary-background-color, rgba(0,0,0,.03)); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
        .iqa-row .meta { min-width:0; flex:1 1 auto; }
        .iqa-row .name { font-weight: 700; line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .iqa-row .entity { font-size: 11px; opacity: .6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .iqa-row .right { text-align:right; flex:0 0 auto; }
        .iqa-row .val { font-weight: 800; }
        .iqa-row .st { display:flex; justify-content:flex-end; gap:6px; align-items:center; opacity:.85; font-weight:600; }

        .tiles { display:grid; gap: 10px; margin-top: 10px; grid-template-columns: repeat(var(--jp2-iqa-cols, 3), minmax(0, 1fr)); }
        .tile { padding: 10px; border-radius: var(--jp2-iqa-tile-radius, 16px); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--secondary-background-color, rgba(0,0,0,.03)); display:flex; flex-direction:column; gap: 8px; min-width: 0; }
        .tile.colored { position:relative; overflow:hidden; border-color: var(--jp2-iqa-tile-border, var(--divider-color, rgba(0,0,0,.12))); }
        .tile.colored::before { content:""; position:absolute; inset:0; border-radius:inherit; background: var(--jp2-iqa-tile-color, var(--primary-color)); opacity:.12; pointer-events:none; }
        .tile.colored > * { position:relative; }
        .tile-top { display:flex; align-items:center; justify-content:space-between; gap: 8px; }
        .tile-name { font-weight: 800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tile-status { display:flex; gap:6px; align-items:center; font-weight:700; opacity:.85; }
        .tile-val { font-weight: 900; font-size: 18px; line-height:1; }
        .tile-unit { font-size: 12px; opacity:.7; margin-top:2px; }
      </style>

      <ha-card>
        <div class="wrap" id="wrap">
          <div class="header" id="header"></div>
          <div class="bar-wrap" id="barWrap"></div>
          <div class="graph" id="graph"></div>
          <div class="iqa" id="iqa"></div>
        </div>
      </ha-card>
    `;

    this._root = this.shadowRoot.getElementById("wrap");
    this._header = this.shadowRoot.getElementById("header");
    this._graphWrap = this.shadowRoot.getElementById("graph");
    this._iqaWrap = this.shadowRoot.getElementById("iqa");
  }

  _setCardBackground(color, enabled) {
    const card = this.shadowRoot.querySelector("ha-card");
    if (!card) return;
    if (enabled && color) {
      card.style.background = cssColorMix(color, 18);
      card.style.backgroundColor = cssColorMix(color, 18);
    } else {
      card.style.background = "";
      card.style.backgroundColor = "";
    }
  }

  _render() {
    if (!this._hass || !this._config) return;

    try {
      const c = this._config;
      const colors = this._colors();

      const card = this.shadowRoot && this.shadowRoot.querySelector ? this.shadowRoot.querySelector("ha-card") : null;
      if (card) {
        card.style.setProperty("--jp2-good", colors.good);
        card.style.setProperty("--jp2-warn", colors.warn);
        card.style.setProperty("--jp2-bad", colors.bad);

        card.style.setProperty("--jp2-icon-size", `${c.icon_size}px`);
        card.style.setProperty("--jp2-icon-inner-size", `${c.icon_inner_size}px`);
        card.style.setProperty("--jp2-title-size", `${c.title_size}px`);
        card.style.setProperty("--jp2-value-size", `${c.value_size}px`);
        card.style.setProperty("--jp2-unit-size", `${c.unit_size}px`);
        card.style.setProperty("--jp2-secondary-value-size", `${c.secondary_value_size}px`);
        card.style.setProperty("--jp2-secondary-unit-size", `${c.secondary_unit_size}px`);
        card.style.setProperty("--jp2-secondary-state-size", `${c.secondary_state_size}px`);
        card.style.setProperty("--jp2-bar-width", `${c.bar?.width ?? 92}%`);
        card.style.setProperty("--jp2-bar-height", `${c.bar?.height ?? 6}px`);
        card.style.setProperty("--jp2-knob-size", `${c.knob_size}px`);
        card.style.setProperty("--jp2-graph-height", `${c.graph_height}px`);

        card.style.setProperty("--jp2-iqa-cols", String(clamp(Number(c.iqa_tiles_per_row || 3), 1, 6)));
        card.style.setProperty("--jp2-iqa-tile-radius", `${clamp(Number(c.iqa_tile_radius ?? 16), 0, 40)}px`);
      }

      if (String(c.card_mode) === "iqa") {
        this._renderIQACard();
        if (this._header) this._header.classList.add("hidden");
        const bw = this.shadowRoot ? this.shadowRoot.getElementById("barWrap") : null;
        if (bw) bw.innerHTML = "";
        if (this._graphWrap) this._graphWrap.classList.remove("show");
        return;
      }

      if (this._iqaWrap) this._iqaWrap.classList.remove("show");
      this._renderSensorCard();
    } catch (err) {
      this._showError("Erreur de rendu", err);
    }
  }


  _renderSensorCard() {
    const c = this._config;
    const entityId = c.entity;
    const stateObj = entityId ? this._hass?.states?.[entityId] : null;

    if (!stateObj) {
      this._header.classList.remove("hidden");
      this._header.innerHTML = `<div style="opacity:.7;">Entité introuvable</div>`;
      const bw = this.shadowRoot.getElementById("barWrap");
      if (bw) bw.innerHTML = "";
      this._graphWrap.classList.remove("show");
      this._setCardBackground("", false);
      return;
    }

    const preset = c.preset || this._detectPreset(entityId, stateObj);
    const value = toNum(stateObj.state);
    const unit = stateObj.attributes?.unit_of_measurement || this._presetConfig(preset).unit_fallback || "";
    const st = this._statusFor(preset, value);
    const statusColor = st.color;

    this._setCardBackground(statusColor, !!c.background_enabled);

    this._header.classList.toggle("hidden", c.show_top === false);

    const iconWrap = el("div", { class: "icon-wrap" }, [
      c.icon_background ? el("div", { class: "icon-bg" }) : null,
      c.icon_circle ? el("div", { class: "icon-circle" }) : null,
      el("ha-icon", { icon: c.icon || DEFAULT_ICON_BY_PRESET[preset] || "mdi:information" }),
    ]);

    this._header.style.setProperty("--jp2-status-color", statusColor);
    this._header.style.setProperty("--jp2-status-outline", cssColorMix(statusColor, 35));

    const titleText = c.name || stateObj.attributes?.friendly_name || entityId;

    const secParts = [];
    if (c.show_secondary !== false) {
      if (c.show_secondary_value !== false && value !== null) secParts.push(el("span", { class: "sv" }, [this._formatValue(preset, value)]));
      if (c.show_secondary_unit !== false && unit) secParts.push(el("span", { class: "su" }, [unit]));
      if (c.show_secondary_state !== false) secParts.push(el("span", { class: "ss" }, [st.label]));
    }

    const titleArea = el("div", { class: "title-area" }, [
      c.show_title === false ? null : el("div", { class: "title" }, [titleText]),
      c.show_secondary === false ? null : el("div", { class: "secondary" }, secParts),
    ]);

    const valueArea = el("div", { class: "value-area" }, [
      c.show_value === false ? null : el("div", { class: "value" }, [value !== null ? this._formatValue(preset, value) : "—"]),
      c.show_unit === false ? null : el("div", { class: "unit" }, [unit]),
    ]);

    this._header.innerHTML = "";
    if (c.show_icon !== false) this._header.appendChild(iconWrap);
    this._header.appendChild(titleArea);
    if (c.show_value !== false || c.show_unit !== false) this._header.appendChild(valueArea);

    const barWrap = this.shadowRoot.getElementById("barWrap");
    if (!barWrap) return;
    const align = String(c.bar?.align || "center");
    barWrap.className = `bar-wrap ${align}`;

    if (c.bar_enabled === false) {
      barWrap.innerHTML = "";
    } else {
      const bar = el("div", { class: "bar" }, [
        el("div", { class: "seg good" }),
        el("div", { class: "seg warn" }),
        el("div", { class: "seg bad" }),
      ]);

      if (c.show_knob !== false && value !== null) {
        const knob = el("div", { class: `knob ${c.knob_outline ? "outline" : ""} ${c.knob_shadow ? "shadow" : ""}` });
        knob.style.left = `${(st.ratio * 100).toFixed(2)}%`;
        bar.appendChild(knob);
      }
      barWrap.innerHTML = "";
      barWrap.appendChild(bar);
    }

    this._renderInternalGraph(entityId, preset);
    this._applyGraphPosition();
  }

  _applyGraphPosition() {
    const c = this._config;
    const pos = String(c.graph_position || "below_top");
    const graph = this._graphWrap;
    const wrap = this._root;
    if (!wrap || !graph) return;

    const header = this._header;
    const barWrap = this.shadowRoot.getElementById("barWrap");
    if (graph.parentElement) graph.parentElement.removeChild(graph);

    if (pos === "top") {
      wrap.insertBefore(graph, header);
    } else if (pos === "bottom") {
      wrap.appendChild(graph);
    } else {
      // below_top or inside_top
      wrap.insertBefore(graph, this._iqaWrap);
    }
  }

  _formatValue(preset, value) {
    const pc = this._presetConfig(preset);
    const dec = Number(pc.decimals ?? 0);
    try {
      return Number(value).toFixed(dec);
    } catch (_) {
      return String(value);
    }
  }

  async _renderInternalGraph(entityId, preset) {
    const c = this._config;
    const graph = this._graphWrap;
    if (!graph) return;

    const enabled = c.show_graph !== false;
    graph.classList.toggle("show", !!enabled);
    if (!enabled) {
      graph.innerHTML = "";
      return;
    }

    const hours = clamp(Number(c.hours_to_show || 24), 1, 168);
    const height = clamp(Number(c.graph_height || 42), 12, 260);
    const strokeW = clamp(Number(c.line_width || 2), 1, 8);

    const colors = this._colors();
    const baseColor = c.graph_color || "var(--primary-color)";
    const warnColor = c.graph_warn_color || colors.warn;
    const badColor = c.graph_bad_color || colors.bad;

    graph.innerHTML = `<div class="msg">Chargement de l'historique…</div>`;
    const points = await this._getHistoryPoints(entityId, hours);

    if (!points || points.length < 2) {
      graph.innerHTML = `<div class="msg">Historique indisponible</div>`;
      return;
    }

    const ys = points.map((p) => toNum(p.state)).filter((v) => v !== null);
    if (ys.length < 2) {
      graph.innerHTML = `<div class="msg">Historique indisponible</div>`;
      return;
    }

    const pc = this._presetConfig(preset);
    const minY = isNum(pc.min) ? pc.min : Math.min(...ys);
    const maxY = isNum(pc.max) ? pc.max : Math.max(...ys);
    const pad = (maxY - minY) * 0.05 || 1;
    const y0 = minY - pad;
    const y1 = maxY + pad;

    const w = 400;
    const h = 100;
    const n = points.length;

    const xy = points
      .map((p, i) => {
        const v = toNum(p.state);
        if (v === null) return null;
        const x = (i / (n - 1)) * w;
        const y = h - ((v - y0) / (y1 - y0)) * h;
        return { x, y, v };
      })
      .filter(Boolean);

    if (xy.length < 2) {
      graph.innerHTML = `<div class="msg">Historique indisponible</div>`;
      return;
    }

    const mode = String(c.graph_color_mode || "segments");
    const svgParts = [];
    svgParts.push(`<line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="${cssColorMix("var(--divider-color)", 60)}" stroke-width="1" />`);

    const pathD = xy.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

    if (mode === "single") {
      svgParts.push(`<path d="${pathD}" fill="none" stroke="${baseColor}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />`);
    } else if (mode === "peaks") {
      svgParts.push(`<path d="${pathD}" fill="none" stroke="${baseColor}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />`);
      for (const p of xy) {
        const st = this._statusFor(preset, p.v);
        if (st.level === "warn" || st.level === "bad") {
          const col = st.level === "warn" ? warnColor : badColor;
          svgParts.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${Math.max(2, strokeW + 1)}" fill="${col}" opacity="0.95" />`);
        }
      }
    } else {
      for (let i = 0; i < xy.length - 1; i++) {
        const a = xy[i], b = xy[i + 1];
        const st = this._statusFor(preset, (a.v + b.v) / 2);
        const col = st.level === "warn" ? warnColor : st.level === "bad" ? badColor : baseColor;
        const d = `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
        svgParts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />`);
      }
    }

    const svg = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Historique">
        ${svgParts.join("")}
      </svg>
    `;

    graph.innerHTML = svg;
  }

  async _getHistoryPoints(entityId, hours) {
    if (!this._hass || !entityId) return null;
    const key = `${entityId}|${hours}`;
    const now = Date.now();
    const cached = this._historyCache.get(key);
    if (cached && now - cached.ts < 60000) return cached.points;
    if (this._historyInflight.has(key)) return await this._historyInflight.get(key);

    const p = (async () => {
      try {
        const start = new Date(Date.now() - hours * 3600000).toISOString();
        const url = `history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response`;
        const res = await this._hass.callApi("GET", url);
        const arr = Array.isArray(res) ? res[0] : null;
        const points = Array.isArray(arr) ? arr : [];
        this._historyCache.set(key, { ts: Date.now(), points });
        return points;
      } catch (e) {
        return null;
      } finally {
        this._historyInflight.delete(key);
      }
    })();

    this._historyInflight.set(key, p);
    return await p;
  }

  _renderIQACard() {
    const c = this._config;
    const iqa = this._iqaWrap;
    if (!iqa) return;

    const entities = Array.isArray(c.iqa_entities) ? c.iqa_entities : [];
    iqa.classList.toggle("show", true);

    const rows = [];
    let globalLevel = "good";
    const levelRank = { good: 0, warn: 1, bad: 2, unknown: -1 };

    for (const eid of entities) {
      const stObj = this._hass?.states?.[eid];
      if (!stObj) continue;
      const preset = this._detectPreset(eid, stObj);
      const value = toNum(stObj.state);
      const unit = stObj.attributes?.unit_of_measurement || this._presetConfig(preset).unit_fallback || "";
      const st = this._statusFor(preset, value);

      if (levelRank[st.level] > levelRank[globalLevel]) globalLevel = st.level;

      const ov = c.iqa_overrides && typeof c.iqa_overrides === "object" ? c.iqa_overrides[eid] || {} : {};
      const icon = ov.icon || DEFAULT_ICON_BY_PRESET[preset] || "mdi:information";
      const iconSize = clamp(Number(ov.icon_size ?? c.iqa_icon_size), 16, 80);
      const innerSize = clamp(Number(ov.icon_inner_size ?? c.iqa_icon_inner_size), 10, 60);

      rows.push({
        eid,
        name: stObj.attributes?.friendly_name || eid,
        value,
        unit,
        status: st,
        preset,
        icon,
        iconSize,
        innerSize,
      });
    }

    const globalLabel = globalLevel === "warn" ? "Moyen" : globalLevel === "bad" ? "Mauvais" : "Bon";
    const globalColor = globalLevel === "warn" ? this._colors().warn : globalLevel === "bad" ? this._colors().bad : this._colors().good;

    this._setCardBackground(globalColor, !!c.iqa_background_enabled);



    const titleText = c.iqa_title || "IQA";
    const titleLeftImage = String(c.iqa_title_left_image || "").trim();
    const titleLeftIcon = String(c.iqa_title_left_icon || "").trim();
    const titleImgSize = clamp(toNum(c.iqa_title_left_image_size) ?? 22, 12, 64);
    const titleIconSize = clamp(toNum(c.iqa_title_left_icon_size) ?? 20, 12, 64);

    const titleKids = [];
    if (titleLeftImage || titleLeftIcon) {
      const leftKids = [];
      if (titleLeftImage) {
        leftKids.push(el("img", {
          class: "iqa-title-img",
          src: titleLeftImage,
          alt: "",
          style: { width: `${titleImgSize}px`, height: `${titleImgSize}px`, objectFit: "contain" }
        }, []));
      }
      if (titleLeftIcon) {
        leftKids.push(el("ha-icon", {
          class: "iqa-title-ico",
          icon: titleLeftIcon,
          style: { "--mdc-icon-size": `${titleIconSize}px`, "--ha-icon-size": `${titleIconSize}px`, width: `${titleIconSize}px`, height: `${titleIconSize}px` }
        }, []));
      }
      titleKids.push(el("span", { class: "iqa-title-left" }, leftKids));
    }
    titleKids.push(el("span", { class: "iqa-title-text" }, [titleText]));

    const titleEl = el("div", { class: `iqa-title${(titleLeftImage || titleLeftIcon) ? " with-prefix" : ""}` }, titleKids);


    const head = el("div", { class: "iqa-head" }, [
      c.iqa_show_title === false ? null : titleEl,
      c.iqa_show_global === false ? null : el("div", { class: "iqa-global" }, [
        el("span", { class: "dot", style: { background: globalColor } }),
        el("span", {}, [globalLabel]),
      ]),
    ]);

    const layout = String(c.iqa_layout || "vertical");
    const iconsOnly = (layout === "horizontal") && !!c.iqa_horizontal_icons_only;
    const showIconBg = c.iqa_icon_background !== false;
    const showIconCircle = c.iqa_icon_circle !== false;

    let body = null;

    if (c.iqa_show_sensors === false) {
      body = el("div", { style: { marginTop: "6px", opacity: ".65", fontSize: "12px" } }, ["(capteurs masqués)"]);
    } else if (layout === "horizontal") {
      const cols = clamp(Number(c.iqa_tiles_per_row || 3), 1, 6);
      iqa.style.setProperty("--jp2-iqa-cols", String(cols));
      iqa.style.setProperty("--jp2-iqa-tile-radius", `${clamp(Number(c.iqa_tile_radius ?? 16), 0, 40)}px`);

      body = el("div", { class: "tiles" }, rows.map((r) => {
        const tile = el("div", { class: `tile ${c.iqa_tile_color_enabled ? "colored" : ""}` });
        const col = r.status.color;
        tile.style.setProperty("--jp2-iqa-tile-color", col);
        const _b = cssColorMix(col, 32);
        tile.style.setProperty("--jp2-iqa-tile-border", _b === "transparent" ? col : _b);

        const iconWrap = el("div", { class: "icon-wrap", style: { width: `${r.iconSize}px`, height: `${r.iconSize}px`, "--jp2-status-color": col, "--jp2-status-outline": cssColorMix(col, 35) } }, [
          showIconBg ? el("div", { class: "icon-bg", style: { background: col } }) : null,
          showIconCircle ? el("div", { class: "icon-circle" }) : null,
          el("ha-icon", { icon: r.icon, style: `--mdc-icon-size:${r.innerSize}px; color:${col};` }),
        ]);

        const topLeft = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", minWidth: "0" } }, [
          c.iqa_show_sensor_icon === false ? null : iconWrap,
          el("div", { style: { minWidth: "0", flex: "1 1 auto" } }, [
            c.iqa_show_sensor_name === false ? null : el("div", { class: "tile-name" }, [r.name]),
            c.iqa_show_sensor_entity ? el("div", { class: "entity" }, [r.eid]) : null,
          ]),
        ]);

        const statusEl = c.iqa_show_sensor_status === false ? null : el("div", { class: "tile-status" }, [
          el("span", { class: "dot", style: { background: col } }),
          el("span", {}, [r.status.label]),
        ]);

        const val = (c.iqa_show_sensor_value === false && c.iqa_show_sensor_unit === false) ? null : el("div", {}, [
          c.iqa_show_sensor_value === false ? null : el("div", { class: "tile-val" }, [r.value !== null ? this._formatValue(r.preset, r.value) : "—"]),
          c.iqa_show_sensor_unit === false ? null : el("div", { class: "tile-unit" }, [r.unit]),
        ]);

        tile.appendChild(el("div", { class: "tile-top" }, [topLeft, statusEl]));
        if (val) tile.appendChild(val);

        tile.addEventListener("click", () => {
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: r.eid }, bubbles: true, composed: true }));
        });

        return tile;
      }));
    } else {
      body = el("div", { class: "iqa-list" }, rows.map((r) => {
        const row = el("div", { class: "iqa-row" });
        const col = r.status.color;

        const iconWrap = el("div", { class: "icon-wrap", style: { width: `${r.iconSize}px`, height: `${r.iconSize}px`, "--jp2-status-color": col, "--jp2-status-outline": cssColorMix(col, 35) } }, [
          showIconBg ? el("div", { class: "icon-bg", style: { background: col } }) : null,
          showIconCircle ? el("div", { class: "icon-circle" }) : null,
          el("ha-icon", { icon: r.icon, style: `--mdc-icon-size:${r.innerSize}px; color:${col};` }),
        ]);

        if (c.iqa_show_sensor_icon !== false) row.appendChild(iconWrap);

        const meta = el("div", { class: "meta" }, [
          c.iqa_show_sensor_name === false ? null : el("div", { class: "name" }, [r.name]),
          c.iqa_show_sensor_entity ? el("div", { class: "entity" }, [r.eid]) : null,
        ]);
        row.appendChild(meta);

        const right = el("div", { class: "right" }, []);
        if (c.iqa_show_sensor_value !== false || c.iqa_show_sensor_unit !== false) {
          right.appendChild(el("div", { class: "val" }, [
            c.iqa_show_sensor_value === false ? null : document.createTextNode(r.value !== null ? this._formatValue(r.preset, r.value) : "—"),
            c.iqa_show_sensor_unit === false ? null : el("span", { style: { marginLeft: "6px", opacity: ".7", fontWeight: "600" } }, [r.unit]),
          ]));
        }
        if (c.iqa_show_sensor_status !== false) {
          right.appendChild(el("div", { class: "st" }, [
            el("span", { class: "dot", style: { background: col } }),
            el("span", {}, [r.status.label]),
          ]));
        }
        row.appendChild(right);

        row.addEventListener("click", () => {
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: r.eid }, bubbles: true, composed: true }));
        });

        return row;
      }));
    }

    iqa.innerHTML = "";
    iqa.appendChild(head);
    if (body) iqa.appendChild(body);
  }
}

// -------------------------
// Editor — Visual (v2.0)
// -------------------------
class Jp2AirQualityCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;

    this._tab = "general";
    this._raf = null;

    // Preview IQA (throttle / chunk)
    this._pvReqId = 0;
    this._pvRaf = null;
    this._pvChunkRaf = null;
    this._pvKey = "";

    this._onTabClick = this._onTabClick.bind(this);
    this._onFormValueChanged = this._onFormValueChanged.bind(this);
    this._onOverridesChanged = this._onOverridesChanged.bind(this);
  }
  disconnectedCallback() {
    try { if (this._raf) cancelAnimationFrame(this._raf); } catch (_) {}
    this._raf = null;
    try { if (this._pvRaf) cancelAnimationFrame(this._pvRaf); } catch (_) {}
    this._pvRaf = null;
    try { if (this._pvChunkRaf) cancelAnimationFrame(this._pvChunkRaf); } catch (_) {}
    this._pvChunkRaf = null;
    this._pvReqId = (this._pvReqId || 0) + 1;
  }



  set hass(hass) {
    this._hass = hass;
    // Propagation aux formulaires existants
    for (const f of Array.from(this.shadowRoot?.querySelectorAll("ha-form") || [])) {
      try { f.hass = hass; } catch (_) {}
    }
    this._scheduleIqaPreview();
  }

  setConfig(config) {
    const stub = Jp2AirQualityCard.getStubConfig();
    const merged = {
      ...stub,
      ...deepClone(config || {}),
      bar: { ...(stub.bar || {}), ...deepClone((config && config.bar) || {}) },
    };

    merged.card_mode = String(merged.card_mode || "sensor");
    merged.preset = String(merged.preset || "radon");
    merged.graph_color_mode = String(merged.graph_color_mode || "segments");
    merged.graph_position = String(merged.graph_position || "below_top");
    merged.iqa_layout = String(merged.iqa_layout || "vertical");

    merged.iqa_entities = Array.isArray(merged.iqa_entities) ? merged.iqa_entities : [];
    merged.iqa_overrides = merged.iqa_overrides && typeof merged.iqa_overrides === "object" ? merged.iqa_overrides : {};

    this._config = merged;

    this._ensureUI();
    this._render();
  }

  get _isIqa() {
    return String(this._config?.card_mode || "sensor") === "iqa";
  }

  _ensureUI() {
    if (this._uiReady) return;
    this._uiReady = true;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .wrap { padding: 12px; display:flex; flex-direction:column; gap: 12px; }
        .hero {
          border-radius: 18px;
          padding: 14px 14px 12px;
          background: linear-gradient(135deg,
            rgba(3,169,244,.18),
            rgba(76,175,80,.10)
          );
          border: 1px solid rgba(255,255,255,.06);
        }
        .hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap: 12px; }
        .title { font-size: 15px; font-weight: 800; letter-spacing: .2px; }
        .subtitle { margin-top: 2px; font-size: 12px; opacity: .75; }
        .badge {
          display:inline-flex; align-items:center; gap: 8px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(0,0,0,.08);
          font-size: 12px; font-weight: 700;
          user-select:none;
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color); }
        .tabs {
          display:flex; gap: 8px;
          overflow:auto;
          padding-bottom: 2px;
          scrollbar-width: thin;
        }
        .tab {
          border: 1px solid rgba(0,0,0,.10);
          background: rgba(0,0,0,.03);
          color: var(--primary-text-color);
          border-radius: 999px;
          padding: 8px 12px;
          font-weight: 700;
          font-size: 12px;
          white-space: nowrap;
          cursor: pointer;
          transition: transform .08s ease, background .12s ease, border-color .12s ease;
        }
        .tab:hover { background: rgba(0,0,0,.06); }
        .tab:active { transform: translateY(1px); }
        .tab.active {
          background: rgba(3,169,244,.18);
          border-color: rgba(3,169,244,.35);
        }

        .content { display:flex; flex-direction:column; gap: 12px; }

        .card {
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(0,0,0,.08);
          background: var(--card-background-color, var(--ha-card-background, var(--paper-card-background-color, #fff)));
        }
        .card-head {
          padding: 12px 14px 10px;
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap: 10px;
          border-bottom: 1px solid rgba(0,0,0,.06);
        }
        .card-head .h { font-weight: 800; }
        .card-head .p { font-size: 12px; opacity: .7; margin-top: 2px; }
        .card-body { padding: 12px 14px 14px; }
        ha-form { display:block; }

        /* IQA preview chips */
        .chips { display:flex; flex-wrap: wrap; gap: 8px; }
        .chip {
          display:inline-flex; align-items:center; gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          background: rgba(0,0,0,.04);
          border: 1px solid rgba(0,0,0,.08);
          font-size: 12px;
          cursor: pointer;
          user-select:none;
        }
        .chip .c-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(0,0,0,.35); }
        .chip .c-name { font-weight: 800; max-width: 180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .chip .c-val { opacity: .75; font-weight: 700; }
        .muted { font-size: 12px; opacity: .72; line-height: 1.35; }

        /* Overrides list */
        .ov-list { display:flex; flex-direction:column; gap: 10px; }
        details.ov {
          border: 1px solid rgba(0,0,0,.08);
          border-radius: 16px;
          background: rgba(0,0,0,.02);
          overflow:hidden;
        }
        details.ov[open] { background: rgba(0,0,0,.03); }
        summary.ov-sum {
          list-style: none;
          cursor: pointer;
          padding: 10px 12px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 10px;
        }
        summary.ov-sum::-webkit-details-marker { display:none; }
        .ov-left { display:flex; flex-direction:column; min-width: 0; }
        .ov-name { font-weight: 900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ov-eid { font-size: 11px; opacity: .65; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ov-right { display:flex; gap: 8px; align-items:center; }
        .ov-pill {
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(0,0,0,.06);
          font-size: 11px;
          font-weight: 800;
          opacity: .85;
        }
        .ov-body { padding: 10px 12px 12px; display:grid; gap: 10px; }
        .ov-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; align-items:start; }
        mwc-button { --mdc-theme-primary: var(--primary-color); }

        .footer { font-size: 12px; opacity: .65; padding: 2px 2px 0; }
      </style>

      <div class="wrap">
        <div class="hero">
          <div class="hero-top">
            <div>
              <div class="title">${CARD_NAME}</div>
              <div class="subtitle">Éditeur visuel v${CARD_VERSION} — configuration rapide & fluide</div>
            </div>
            <div class="badge" id="modeBadge"><span class="dot"></span><span id="modeText">—</span></div>
          </div>
          <div class="tabs" id="tabs"></div>
        </div>

        <div class="content" id="content"></div>
        <div class="footer">Astuce : si tu préfères le YAML, tu peux toujours basculer l’éditeur de carte en mode code.</div>
      </div>
    `;

    this.shadowRoot.getElementById("tabs").addEventListener("click", this._onTabClick);
  }

  _render() {
    if (!this._config) return;

    // Tabs dépendants du mode
    const tabs = this._buildTabs();
    if (!tabs.some(t => t.id === this._tab)) this._tab = tabs[0]?.id || "general";

    const tabsEl = this.shadowRoot.getElementById("tabs");
    tabsEl.innerHTML = "";
    for (const t of tabs) {
      const b = document.createElement("button");
      b.className = `tab ${this._tab === t.id ? "active" : ""}`;
      b.type = "button";
      b.dataset.tab = t.id;
      b.textContent = t.label;
      tabsEl.appendChild(b);
    }

    const badge = this.shadowRoot.getElementById("modeBadge");
    const modeText = this.shadowRoot.getElementById("modeText");
    const isIqa = this._isIqa;
    modeText.textContent = isIqa ? "IQA (multi-capteurs)" : "Capteur (1 entité)";
    badge.querySelector(".dot").style.background = isIqa ? "rgba(76,175,80,.9)" : "rgba(3,169,244,.9)";

    const content = this.shadowRoot.getElementById("content");
    content.innerHTML = "";
    content.appendChild(this._renderTabContent(this._tab));

    // Assure hass sur tous les ha-form rendus
    for (const f of Array.from(this.shadowRoot.querySelectorAll("ha-form"))) {
      try { f.hass = this._hass; } catch (_) {}
    }

    // Refresh preview if present
    this._scheduleIqaPreview();
  }

  _buildTabs() {
    if (this._isIqa) {
      return [
        { id: "general", label: "Général" },
        { id: "iqa_entities", label: "Entités" },
        { id: "iqa_layout", label: "Disposition" },
        { id: "iqa_icons", label: "Icônes" },
        { id: "iqa_overrides", label: "Overrides" },
      ];
    }
    return [
      { id: "general", label: "Général" },
      { id: "display", label: "Affichage" },
      { id: "graph", label: "Graphe" },
      { id: "colors", label: "Couleurs" },
    ];
  }

  _onTabClick(ev) {
    const path = (ev && typeof ev.composedPath === "function") ? ev.composedPath() : (ev && ev.path) ? ev.path : [];
    const btn = (path && path.find((n) => n && n.dataset && n.dataset.tab)) || (ev?.target?.closest ? ev.target.closest("[data-tab]") : null);
    if (!btn) return;
    const next = btn.dataset.tab;
    if (!next || next === this._tab) return;
    this._tab = next;
    this._render();
  }

  _renderTabContent(tabId) {
    const root = document.createElement("div");
    root.style.display = "contents";

    if (!this._config) return root;

    const isIqa = this._isIqa;

    // ---- SENSOR MODE TABS ----
    if (!isIqa) {
      if (tabId === "general") {
        root.appendChild(this._section(
          "Configuration",
          "Choisis le type de carte et l’entité. Le preset ajuste automatiquement unités et seuils.",
          this._makeForm(this._schemaSensorGeneral(), this._config)
        ));
        return root;
      }
      if (tabId === "display") {
        root.appendChild(this._section(
          "Affichage",
          "Active/masque les blocs, ajuste les tailles (icônes, typo, knob).",
          this._makeForm(this._schemaSensorDisplay(), this._config)
        ));
        return root;
      }
      if (tabId === "graph") {
        root.appendChild(this._section(
          "Graphe interne",
          "Historique léger (sans mini-graph-card). Ajuste hauteur, heures et mode de couleurs.",
          this._makeForm(this._schemaSensorGraph(), this._config)
        ));
        return root;
      }
      if (tabId === "colors") {
        root.appendChild(this._section(
          "Couleurs & barre",
          "Couleurs Bon / Moyen / Mauvais + dimensions/alignement de la barre.",
          this._makeForm(this._schemaBar(), this._config)
        ));
        return root;
      }
      return root;
    }

    // ---- IQA MODE TABS ----
    if (tabId === "general") {
      root.appendChild(this._section(
        "IQA — Général",
        "Carte multi-capteurs : titre, affichage global, fond, etc.",
        this._makeForm(this._schemaIqaGeneral(), this._config)
      ));
      root.appendChild(this._section(
        "Aperçu rapide",
        "Clique sur une pastille pour ouvrir “Plus d’infos” sur le capteur.",
        this._iqaPreview()
      ));
      return root;
    }

    if (tabId === "iqa_entities") {
      root.appendChild(this._section(
        "IQA — Entités",
        "Sélectionne tes capteurs (ordre = ordre d’affichage).",
        this._makeForm(this._schemaIqaEntities(), this._config)
      ));
      root.appendChild(this._section(
        "Aperçu rapide",
        "Clique sur une pastille pour ouvrir “Plus d’infos”.",
        this._iqaPreview()
      ));
      return root;
    }

    if (tabId === "iqa_layout") {
      root.appendChild(this._section(
        "IQA — Disposition",
        "Choisis la disposition (liste verticale ou tuiles horizontales) + options de tuiles.",
        this._makeForm(this._schemaIqaLayout(), this._config)
      ));
      return root;
    }

    if (tabId === "iqa_icons") {
      root.appendChild(this._section(
        "IQA — Icônes & contenu",
        "Contrôle ce qui est affiché par capteur + style des icônes.",
        this._makeForm(this._schemaIqaRowDisplay(), this._config)
      ));
      root.appendChild(this._section(
        "Style des icônes",
        "Taille du cercle, taille du pictogramme, fond et cercle.",
        this._makeForm(this._schemaIqaIconStyle(), this._config)
      ));
      return root;
    }

    if (tabId === "iqa_overrides") {
      root.appendChild(this._section(
        "Overrides par capteur",
        "Surcharge l’icône et les tailles pour des entités spécifiques. (Optionnel)",
        this._overridesEditor()
      ));
      return root;
    }

    return root;
  }

  _section(title, subtitle, bodyEl) {
    const card = document.createElement("div");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `
      <div>
        <div class="h">${title}</div>
        <div class="p">${subtitle || ""}</div>
      </div>
    `;
    const body = document.createElement("div");
    body.className = "card-body";
    body.appendChild(bodyEl);
    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  _makeForm(schema, data) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.schema = schema;
    form.data = data;
    form.computeLabel = (s) => this._computeLabel(s);
    form.computeHelper = (s) => this._computeHelper(s);

    form.addEventListener("value-changed", this._onFormValueChanged);
    return form;
  }

    _computeLabel(s) {
    const n = s?.name || "";
    const map = {
      // general
      card_mode: "Type de carte",
      entity: "Entité",
      preset: "Preset",
      name: "Nom",
      icon: "Icône",
      // sensor display
      background_enabled: "Fond coloré",
      bar_enabled: "Afficher la barre",
      show_graph: "Afficher le graphe",
      show_top: "Afficher l'en-tête",
      show_title: "Afficher le titre",
      show_secondary: "Afficher la ligne 2",
      show_secondary_value: "Ligne 2 : valeur",
      show_secondary_unit: "Ligne 2 : unité",
      show_secondary_state: "Ligne 2 : statut",
      show_icon: "Afficher l'icône",
      show_value: "Afficher la valeur",
      show_unit: "Afficher l'unité",
      show_knob: "Afficher le repère",
      knob_size: "Taille repère (px)",
      knob_outline: "Contour repère",
      knob_shadow: "Ombre repère",
      icon_size: "Taille icône (px)",
      icon_inner_size: "Taille pictogramme (px)",
      icon_background: "Fond icône",
      icon_circle: "Cercle icône",
      // typography
      title_size: "Taille titre (px)",
      value_size: "Taille valeur (px)",
      unit_size: "Taille unité (px)",
      secondary_value_size: "Taille valeur L2 (px)",
      secondary_unit_size: "Taille unité L2 (px)",
      secondary_state_size: "Taille statut L2 (px)",
      // graph
      graph_position: "Position du graphe",
      hours_to_show: "Heures affichées",
      graph_height: "Hauteur graphe (px)",
      line_width: "Épaisseur ligne",
      graph_color_mode: "Mode couleur",
      graph_color: "Couleur ligne",
      graph_warn_color: "Couleur warn",
      graph_bad_color: "Couleur bad",
      // bar colors
      good: "Bon (couleur)",
      warn: "Moyen (couleur)",
      bad: "Mauvais (couleur)",
      width: "Largeur (%)",
      height: "Hauteur (px)",
      align: "Alignement",
      // IQA general
      iqa_title: "Titre",
      iqa_show_title: "Afficher le titre",
      iqa_show_global: "Afficher le statut global",
      iqa_show_sensors: "Afficher les capteurs",
      iqa_background_enabled: "Fond coloré",
      // IQA entities / layout
      iqa_entities: "Entités (capteurs)",
      iqa_layout: "Disposition",
      iqa_tiles_per_row: "Tuiles par ligne",
      iqa_tile_color_enabled: "Fond coloré par tuile",
      iqa_tile_radius: "Arrondi des tuiles (px)",
      // IQA rows
      iqa_show_sensor_icon: "Afficher l'icône",
      iqa_show_sensor_name: "Afficher le nom",
      iqa_show_sensor_entity: "Afficher l'entité",
      iqa_show_sensor_value: "Afficher la valeur",
      iqa_show_sensor_unit: "Afficher l'unité",
      iqa_show_sensor_status: "Afficher le statut",
      // IQA icons
      iqa_icon_size: "Taille icône (cercle)",
      iqa_icon_inner_size: "Taille pictogramme",
      iqa_icon_background: "Fond icône",
      iqa_icon_circle: "Cercle icône",
    };
    return map[n] || n;
  }

  _computeHelper(s) {
    const n = s?.name || "";
    const map = {
      graph_color: "Ex: #03a9f4 (laisse vide pour auto).",
      graph_warn_color: "Couleur pour la zone warn (pics/segments).",
      graph_bad_color: "Couleur pour la zone bad (pics/segments).",
      good: "Couleur du statut “Bon”.",
      warn: "Couleur du statut “Moyen”.",
      bad: "Couleur du statut “Mauvais”.",
      iqa_entities: "Tu peux sélectionner plusieurs entités.",
    };
    return map[n] || "";
  }

_onFormValueChanged(ev) {
    if (!this._config) return;
    const value = ev.detail?.value || {};
    // ha-form renvoie généralement un objet complet si data = config.
    // On sécurise quand même (bar nested).
    const next = {
      ...this._config,
      ...value,
      bar: { ...(this._config.bar || {}), ...(value.bar || {}) },
    };

    // Normalisation soft
    next.card_mode = String(next.card_mode || "sensor");
    next.preset = String(next.preset || "radon");
    next.iqa_layout = String(next.iqa_layout || "vertical");
    next.iqa_tiles_per_row = clamp(Number(next.iqa_tiles_per_row || 3), 1, 6);
    next.iqa_tile_radius = clamp(Number(next.iqa_tile_radius ?? 16), 0, 40);

    next.iqa_entities = Array.isArray(next.iqa_entities) ? next.iqa_entities : [];
    next.iqa_overrides = next.iqa_overrides && typeof next.iqa_overrides === "object" ? next.iqa_overrides : {};

    this._config = next;

    // Throttle la notification HA (évite boucle / reflow)
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._fireConfigChanged(this._config);
      // Re-render si changement de mode ou tab invalide
      this._render();
    });
  }

  // -------------------------
  // Schemas (split forms)
  // -------------------------
  _schemaSensorGeneral() {
    return [
      { name: "card_mode", selector: { select: { options: [
        { label: "Capteur Card", value: "sensor" },
        { label: "IQA Card (multi-capteurs)", value: "iqa" },
      ], mode: "dropdown" } } },
      { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
      { name: "preset", selector: { select: { options: [
        { label: "Radon", value: "radon" },
        { label: "Pression", value: "pressure" },
        { label: "Humidité", value: "humidity" },
        { label: "Température", value: "temperature" },
        { label: "COV / TVOC", value: "voc" },
        { label: "PM1", value: "pm1" },
        { label: "PM2.5", value: "pm25" },
        { label: "CO₂", value: "co2" },
      ], mode: "dropdown" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} }, context: { icon_entity: "entity" } },
      { name: "background_enabled", selector: { boolean: {} } },
      { name: "bar_enabled", selector: { boolean: {} } },
      { name: "show_graph", selector: { boolean: {} } },
    ];
  }

  _schemaSensorDisplay() {
    return [
      {
        type: "grid", name: "", flatten: true, column_min_width: "220px",
        schema: [
          { name: "show_top", selector: { boolean: {} } },
          { name: "show_title", selector: { boolean: {} } },
          { name: "show_secondary", selector: { boolean: {} } },
          { name: "show_secondary_value", selector: { boolean: {} } },
          { name: "show_secondary_unit", selector: { boolean: {} } },
          { name: "show_secondary_state", selector: { boolean: {} } },
          { name: "show_icon", selector: { boolean: {} } },
          { name: "show_value", selector: { boolean: {} } },
          { name: "show_unit", selector: { boolean: {} } },
          { name: "show_knob", selector: { boolean: {} } },
          { name: "knob_size", selector: { number: { min: 6, max: 24, mode: "box", step: 1 } } },
          { name: "knob_outline", selector: { boolean: {} } },
          { name: "knob_shadow", selector: { boolean: {} } },
          { name: "icon_size", selector: { number: { min: 16, max: 80, mode: "box", step: 1 } } },
          { name: "icon_inner_size", selector: { number: { min: 10, max: 60, mode: "box", step: 1 } } },
          { name: "icon_background", selector: { boolean: {} } },
          { name: "icon_circle", selector: { boolean: {} } },
        ]
      },
      {
        type: "grid", name: "", flatten: true, column_min_width: "220px",
        schema: [
          { name: "title_size", selector: { number: { min: 10, max: 26, mode: "box", step: 1 } } },
          { name: "value_size", selector: { number: { min: 10, max: 30, mode: "box", step: 1 } } },
          { name: "unit_size", selector: { number: { min: 9, max: 20, mode: "box", step: 1 } } },
          { name: "secondary_value_size", selector: { number: { min: 9, max: 18, mode: "box", step: 1 } } },
          { name: "secondary_unit_size", selector: { number: { min: 9, max: 18, mode: "box", step: 1 } } },
          { name: "secondary_state_size", selector: { number: { min: 9, max: 18, mode: "box", step: 1 } } },
        ]
      }
    ];
  }

  _schemaSensorGraph() {
    return [
      { name: "graph_position", selector: { select: { options: [
        { label: "Sous l'en-tête", value: "below_top" },
        { label: "Dans l'en-tête (sous la barre)", value: "inside_top" },
        { label: "En haut", value: "top" },
        { label: "En bas", value: "bottom" },
      ], mode: "dropdown" } } },
      { name: "hours_to_show", selector: { number: { min: 1, max: 168, mode: "box", step: 1 } } },
      { name: "graph_height", selector: { number: { min: 20, max: 120, mode: "box", step: 1 } } },
      { name: "line_width", selector: { number: { min: 1, max: 6, mode: "box", step: 1 } } },
      { name: "graph_color_mode", selector: { select: { options: [
        { label: "Couleur unique", value: "single" },
        { label: "Pics orange/rouge", value: "peaks" },
        { label: "Segments orange/rouge", value: "segments" },
      ], mode: "dropdown" } } },
      { name: "graph_color", selector: { text: {} } },
      { name: "graph_warn_color", selector: { text: {} } },
      { name: "graph_bad_color", selector: { text: {} } },
    ];
  }

  _schemaBar() {
    return [
      {
        type: "grid", name: "", flatten: true, column_min_width: "220px",
        schema: [
          { name: "good", selector: { text: {} }, path: "bar" },
          { name: "warn", selector: { text: {} }, path: "bar" },
          { name: "bad", selector: { text: {} }, path: "bar" },
          { name: "width", selector: { number: { min: 50, max: 100, mode: "box", step: 1 } }, path: "bar" },
          { name: "height", selector: { number: { min: 4, max: 18, mode: "box", step: 1 } }, path: "bar" },
          { name: "align", selector: { select: { options: [
            { label: "Centré", value: "center" },
            { label: "Gauche", value: "left" },
            { label: "Droite", value: "right" },
          ], mode: "dropdown" } }, path: "bar" },
        ],
      },
    ];
  }

  _schemaIqaGeneral() {
    return [
      { name: "card_mode", selector: { select: { options: [
        { label: "Capteur Card", value: "sensor" },
        { label: "IQA Card (multi-capteurs)", value: "iqa" },
      ], mode: "dropdown" } } },
      { name: "iqa_title", selector: { text: {} } },
      { name: "iqa_title_left_image", selector: { text: {} } },
      { name: "iqa_title_left_image_size", selector: { number: { min: 12, max: 64, mode: "box", step: 1 } } },
      { name: "iqa_title_left_icon", selector: { icon: {} } },
      { name: "iqa_title_left_icon_size", selector: { number: { min: 12, max: 64, mode: "box", step: 1 } } },
      { name: "iqa_show_title", selector: { boolean: {} } },
      { name: "iqa_show_global", selector: { boolean: {} } },
      { name: "iqa_show_sensors", selector: { boolean: {} } },
      { name: "iqa_background_enabled", selector: { boolean: {} } },
    ];
  }

  _schemaIqaEntities() {
    return [
      { name: "iqa_entities", selector: { entity: { domain: "sensor", multiple: true } } },
    ];
  }

  _schemaIqaLayout() {
    return [
      { name: "iqa_layout", selector: { select: { options: [
        { label: "Vertical (liste)", value: "vertical" },
        { label: "Horizontal (tuiles)", value: "horizontal" },
      ], mode: "dropdown" } } },
      { name: "iqa_horizontal_icons_only", selector: { boolean: {} } },
      { name: "iqa_tiles_per_row", selector: { number: { min: 1, max: 6, mode: "box", step: 1 } } },
      { name: "iqa_tile_color_enabled", selector: { boolean: {} } },
      { name: "iqa_tile_radius", selector: { number: { min: 0, max: 40, mode: "box", step: 1 } } },
    ];
  }

  _schemaIqaRowDisplay() {
    return [
      {
        type: "grid", name: "", flatten: true, column_min_width: "220px",
        schema: [
          { name: "iqa_show_sensor_icon", selector: { boolean: {} } },
          { name: "iqa_show_sensor_name", selector: { boolean: {} } },
          { name: "iqa_show_sensor_entity", selector: { boolean: {} } },
          { name: "iqa_show_sensor_value", selector: { boolean: {} } },
          { name: "iqa_show_sensor_unit", selector: { boolean: {} } },
          { name: "iqa_show_sensor_status", selector: { boolean: {} } },
        ],
      },
    ];
  }

  _schemaIqaIconStyle() {
    return [
      { name: "iqa_icon_size", selector: { number: { min: 16, max: 80, mode: "box", step: 1 } } },
      { name: "iqa_icon_inner_size", selector: { number: { min: 10, max: 60, mode: "box", step: 1 } } },
      { name: "iqa_icon_background", selector: { boolean: {} } },
      { name: "iqa_icon_circle", selector: { boolean: {} } },
    ];
  }

  // -------------------------
  // IQA preview / overrides
  // -------------------------

  _scheduleIqaPreview(force = false) {
    const wrap = this.shadowRoot?.getElementById("iqaPreview");
    if (!wrap) return;

    if (!this._hass || !this._config) {
      wrap.innerHTML = `<div class="muted">Aperçu indisponible (hass non prêt).</div>`;
      return;
    }

    if (!this._isIqa) return;

    const ents = Array.isArray(this._config.iqa_entities) ? this._config.iqa_entities : [];
    if (!ents.length) {
      wrap.innerHTML = `<div class="muted">Aucune entité IQA sélectionnée.</div>`;
      return;
    }

    let key = ents.join("|");
    for (const eid of ents) {
      const st = this._hass.states?.[eid];
      if (st) key += `;${st.state}|${st.last_changed || st.last_updated || ""}`;
      else key += ";—";
    }

    if (!force && key === this._pvKey) return;
    this._pvKey = key;

    try { if (this._pvRaf) cancelAnimationFrame(this._pvRaf); } catch (_) {}
    this._pvRaf = null;
    try { if (this._pvChunkRaf) cancelAnimationFrame(this._pvChunkRaf); } catch (_) {}
    this._pvChunkRaf = null;

    const reqId = ++this._pvReqId;

    this._pvRaf = requestAnimationFrame(() => {
      this._pvRaf = null;
      if (reqId !== this._pvReqId) return;
      this._renderIqaPreview(reqId);
    });
  }


  _iqaPreview() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Chargement de l’aperçu…</div>`;
    wrap.id = "iqaPreview";
    return wrap;
  }


  _renderIqaPreview(reqId) {
    const wrap = this.shadowRoot?.getElementById("iqaPreview");
    if (!wrap) return;

    if (!this._hass || !this._config) {
      wrap.innerHTML = `<div class="muted">Aperçu indisponible (hass non prêt).</div>`;
      return;
    }

    const ents = Array.isArray(this._config.iqa_entities) ? this._config.iqa_entities : [];
    if (!ents.length) {
      wrap.innerHTML = `<div class="muted">Aucune entité IQA sélectionnée.</div>`;
      return;
    }

    const chips = document.createElement("div");
    chips.className = "chips";
    wrap.innerHTML = "";
    wrap.appendChild(chips);

    const CHUNK = 24;
    let i = 0;

    const addOne = (eid) => {
      const st = this._hass.states?.[eid];
      const name = st?.attributes?.friendly_name || eid;
      const unit = st?.attributes?.unit_of_measurement ? String(st.attributes.unit_of_measurement) : "";
      const val = st ? `${st.state}${unit ? " " + unit : ""}` : "—";
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `
        <span class="c-dot"></span>
        <span class="c-name" title="${name}">${name}</span>
        <span class="c-val">${val}</span>
      `;
      chip.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: eid },
          bubbles: true,
          composed: true,
        }));
      });
      chips.appendChild(chip);
    };

    if (ents.length <= CHUNK) {
      for (const eid of ents) addOne(eid);
      return;
    }

    const step = () => {
      if (reqId !== this._pvReqId) return;
      const end = Math.min(i + CHUNK, ents.length);
      for (; i < end; i++) addOne(ents[i]);
      if (i < ents.length) {
        this._pvChunkRaf = requestAnimationFrame(step);
      } else {
        this._pvChunkRaf = null;
      }
    };

    this._pvChunkRaf = requestAnimationFrame(step);
  }


  _overridesEditor() {
    const wrap = document.createElement("div");
    wrap.id = "overridesEditor";
    this._renderOverridesInto(wrap);
    return wrap;
  }

  _renderOverridesInto(wrap) {
    if (!wrap) return;
    const ents = Array.isArray(this._config?.iqa_entities) ? this._config.iqa_entities : [];
    const overrides = (this._config?.iqa_overrides && typeof this._config.iqa_overrides === "object") ? this._config.iqa_overrides : {};

    if (!ents.length) {
      wrap.innerHTML = `<div class="muted">Ajoute des entités dans l’onglet “Entités” pour configurer des overrides.</div>`;
      return;
    }

    const list = document.createElement("div");
    list.className = "ov-list";

    for (const eid of ents) {
      const st = this._hass?.states?.[eid];
      const name = st?.attributes?.friendly_name || eid;
      const ov = overrides[eid] || {};

      const det = document.createElement("details");
      det.className = "ov";

      const sum = document.createElement("summary");
      sum.className = "ov-sum";
      sum.innerHTML = `
        <div class="ov-left">
          <div class="ov-name">${name}</div>
          <div class="ov-eid">${eid}</div>
        </div>
        <div class="ov-right">
          <div class="ov-pill">${ov.icon ? "Icône" : "Auto"}</div>
          <div class="ov-pill">${ov.icon_size || ""}${ov.icon_size ? "px" : ""}</div>
        </div>
      `;

      const body = document.createElement("div");
      body.className = "ov-body";

      const grid = document.createElement("div");
      grid.className = "ov-grid";

      // Icon picker (fallback textfield)
      const iconField = this._iconField("Icône", ov.icon || "");
      iconField.addEventListener("value-changed", (e) => {
        const v = e.detail?.value ?? "";
        this._onOverridesChanged(eid, "icon", v);
      });

      const sizeField = this._numField("Taille cercle", ov.icon_size ?? "", 16, 80, 1);
      sizeField.addEventListener("change", () => {
        const v = sizeField.value === "" ? null : clamp(Number(sizeField.value), 16, 80);
        this._onOverridesChanged(eid, "icon_size", v, { clearOnNull: true });
      });

      const innerField = this._numField("Taille pictogramme", ov.icon_inner_size ?? "", 10, 60, 1);
      innerField.addEventListener("change", () => {
        const v = innerField.value === "" ? null : clamp(Number(innerField.value), 10, 60);
        this._onOverridesChanged(eid, "icon_inner_size", v, { clearOnNull: true });
      });

      grid.appendChild(iconField);
      grid.appendChild(sizeField);
      grid.appendChild(innerField);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "10px";
      actions.style.justifyContent = "flex-end";

      const reset = document.createElement("mwc-button");
      reset.label = "Reset";
      reset.addEventListener("click", () => {
        const next = deepClone(this._config);
        next.iqa_overrides = { ...(next.iqa_overrides || {}) };
        delete next.iqa_overrides[eid];
        this._config = next;
        this._fireConfigChanged(this._config);
        this._render();
      });

      actions.appendChild(reset);

      body.appendChild(grid);
      body.appendChild(actions);

      det.appendChild(sum);
      det.appendChild(body);
      list.appendChild(det);
    }

    wrap.innerHTML = "";
    wrap.appendChild(list);
  }

  _iconField(label, value) {
    if (customElements.get("ha-icon-picker")) {
      const picker = document.createElement("ha-icon-picker");
      picker.label = label;
      picker.value = value || "";
      return picker;
    }
    const tf = document.createElement("ha-textfield");
    tf.label = label;
    tf.value = value || "";
    tf.placeholder = "mdi:...";
    tf.addEventListener("change", () => {
      tf.dispatchEvent(new CustomEvent("value-changed", { detail: { value: tf.value }, bubbles: true, composed: true }));
    });
    return tf;
  }

  _numField(label, value, min, max, step) {
    const tf = document.createElement("ha-textfield");
    tf.type = "number";
    tf.label = label;
    tf.min = String(min);
    tf.max = String(max);
    tf.step = String(step);
    tf.value = (value === undefined || value === null) ? "" : String(value);
    return tf;
  }

  _onOverridesChanged(eid, key, value, { clearOnNull = false } = {}) {
    const next = deepClone(this._config);
    next.iqa_overrides = { ...(next.iqa_overrides || {}) };
    next.iqa_overrides[eid] = { ...(next.iqa_overrides[eid] || {}) };

    if (clearOnNull && (value === null || value === "")) delete next.iqa_overrides[eid][key];
    else next.iqa_overrides[eid][key] = value;

    // cleanup empty objects
    for (const [id, ov] of Object.entries(next.iqa_overrides)) {
      if (!ov || typeof ov !== "object" || Object.keys(ov).length === 0) delete next.iqa_overrides[id];
    }

    this._config = next;
    this._fireConfigChanged(this._config);
    this._render();
  }

  _fireConfigChanged(cfg) {
    const cleaned = deepClone(cfg);

    // Nettoyage des overrides vides / null
    if (cleaned.iqa_overrides && typeof cleaned.iqa_overrides === "object") {
      for (const [eid, ov] of Object.entries(cleaned.iqa_overrides)) {
        if (!ov || typeof ov !== "object") { delete cleaned.iqa_overrides[eid]; continue; }
        for (const k of ["icon", "icon_size", "icon_inner_size"]) {
          if (ov[k] === null || ov[k] === "" || ov[k] === undefined) delete ov[k];
        }
        if (Object.keys(ov).length === 0) delete cleaned.iqa_overrides[eid];
      }
    }

    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: cleaned },
      bubbles: true,
      composed: true,
    }));
  }
}

try {
  if (!customElements.get("jp2-air-quality-editor")) customElements.define("jp2-air-quality-editor", Jp2AirQualityCardEditor);
} catch (e) {
  // évite que le chargement du fichier casse tout si déjà défini
  console.warn(`[${CARD_NAME}] editor already defined or failed to define`, e);
}

try {
  if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, Jp2AirQualityCard);
} catch (e) {
  console.warn(`[${CARD_NAME}] card already defined or failed to define`, e);
}

window.customCards = window.customCards || [];
window.customCards.push({ type: CARD_TYPE, name: CARD_NAME, description: CARD_DESC, version: CARD_VERSION });

console.info(`%c ${CARD_NAME} %c v${CARD_VERSION} `, "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4; background: white; font-weight: 700;");
