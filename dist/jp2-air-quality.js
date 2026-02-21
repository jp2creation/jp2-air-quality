
/*
  JP2 Air Quality Card
  File name must remain: jp2-air-quality.js

  Release notes — v2.1.6 (Optimized)
  - Refactor: Gestion du cycle de vie améliorée (disconnectedCallback pour nettoyage mémoire).
  - Perf: Utilisation d'AbortController pour annuler les requêtes d'historique obsolètes.
  - Fix: Nettoyage propre des timers (raf, timeouts) et des EventListeners globaux.
  - Perf: Optimisation de set hass pour éviter les calculs inutiles si la config n'a pas changé.
*/

const CARD_TYPE = "jp2-air-quality";
const CARD_NAME = "JP2 Air Quality";
const CARD_DESC = "Air quality card (sensor + AQI multi-sensors) with internal history graph, full-screen visualizer, and a fluid visual editor (v2).";
const CARD_VERSION = "2.1.6";
const CARD_BUILD_DATE = "2026-02-21";

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


// Preset personnalisé (capteur libre) — valeurs par défaut
function jp2DefaultCustomPreset() {
  return {
    type: "rising",
    decimals: 0,
    unit_fallback: "",
    min: 0,
    max: 100,
    good_max: 50,
    warn_max: 80,
    warn_low_min: 30,
    good_min: 40,
    good_max_band: 60,
    warn_high_max: 70,
    label_good: "Bon",
    label_warn: "Moyen",
    label_bad: "Mauvais",
  };
}

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

function jp2ParseHourRanges(raw, fallback = "6,12,24,72,168") {
  const max = 12;
  const normNum = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    const v = Math.round(x);
    if (v < 1 || v > 720) return null;
    return v;
  };

  const fromString = (s) => String(s || "")
    .split(/[,;\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(normNum)
    .filter((v) => v !== null);

  let arr = null;
  if (Array.isArray(raw)) arr = raw.map(normNum).filter((v) => v !== null);
  else if (typeof raw === "string") arr = fromString(raw);
  else if (raw == null || raw === "") arr = fromString(fallback);
  else arr = fromString(String(raw));

  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out.length ? out : fromString(fallback);
}

function jp2FormatHourLabel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return String(hours);
  if (h < 24) return `${h}h`;
  const d = h / 24;
  if (Number.isInteger(d)) return `${d}j`;
  return `${h}h`;
}

function jp2BestTimestamp(obj) {
  const keys = ["last_changed", "last_updated", "last_reported", "lc", "lu"];
  for (const k of keys) {
    const v = obj && obj[k];
    if (!v) continue;
    if (typeof v === "number") return v * 1000;
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return t;
  }
  return null;
}


function normalizeKnobColorMode(cfg) {
  const raw =
    (cfg && cfg.knob_color_mode != null) ? cfg.knob_color_mode :
    (cfg && cfg.bar && cfg.bar.knob_color_mode != null) ? cfg.bar.knob_color_mode :
    "theme";

  const v = String(raw).trim().toLowerCase();
  const norm = v
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");

  if (norm === "status" || norm === "statut" || norm === "couleur statut" || norm === "status color") return "status";
  if (norm === "theme" || norm === "couleur theme") return "theme";
  if (norm === "true" || norm === "1" || norm === "yes") return "status";
  if (norm === "false" || norm === "0" || norm === "no") return "theme";

  return "theme";
}


const _JP2_UA = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
const _JP2_IS_SAFARI = /Safari/i.test(_JP2_UA) && !/(Chrome|Chromium|Edg|OPR)/i.test(_JP2_UA);
const _JP2_SUPPORTS_COLOR_MIX = !_JP2_IS_SAFARI && (typeof CSS !== "undefined") && CSS.supports && CSS.supports("color", "color-mix(in srgb, #000 10%, transparent)");

let _JP2_COLOR_PROBE = null;
const _JP2_COLOR_CACHE = new WeakMap();

function jp2ResolveCssColorToRgba(color, alpha = 1, scopeEl) {
  try {
    const aMul = Math.max(0, Math.min(1, Number(alpha)));
    const c = String(color || "").trim();
    if (!c) return "rgba(0,0,0,0)";

    const direct = c.match(/rgba?\(([^)]+)\)/i);
    if (direct) {
      const parts = direct[1].split(",").map((s) => s.trim());
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      let a0 = parts.length > 3 ? Number(parts[3]) : 1;
      if (!isFinite(a0)) a0 = 1;
      const a = Math.max(0, Math.min(1, a0 * aMul));
      return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    const scope = (scopeEl && scopeEl.appendChild) ? scopeEl : document.documentElement;
    let perScope = _JP2_COLOR_CACHE.get(scope);
    if (!perScope) {
      perScope = new Map();
      _JP2_COLOR_CACHE.set(scope, perScope);
    }

    let computed = perScope.get(c);
    if (!computed) {
      if (!_JP2_COLOR_PROBE) {
        _JP2_COLOR_PROBE = document.createElement("span");
        _JP2_COLOR_PROBE.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;";
      }

      _JP2_COLOR_PROBE.style.color = c;
      if (!_JP2_COLOR_PROBE.isConnected || _JP2_COLOR_PROBE.parentNode !== scope) {
        try { _JP2_COLOR_PROBE.remove(); } catch (_) {}
        try { scope.appendChild(_JP2_COLOR_PROBE); } catch (_) { document.documentElement.appendChild(_JP2_COLOR_PROBE); }
      }

      computed = getComputedStyle(_JP2_COLOR_PROBE).color || "rgba(0,0,0,0)";
      perScope.set(c, computed);
      if (perScope.size > 80) perScope.clear();
    }

    const m = computed.match(/rgba?\(([^)]+)\)/i);
    if (!m) return "rgba(0,0,0,0)";
    const parts = m[1].split(",").map((s) => s.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    let a0 = parts.length > 3 ? Number(parts[3]) : 1;
    if (!isFinite(a0)) a0 = 1;

    const a = Math.max(0, Math.min(1, a0 * aMul));
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  } catch (_) {
    return "rgba(0,0,0,0)";
  }
}

function cssColorMix(color, pct, scopeEl) {
  const p = clamp(pct, 0, 100);
  if (_JP2_SUPPORTS_COLOR_MIX) return `color-mix(in srgb, ${color} ${p}%, transparent)`;

  const c = String(color || "").trim();
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(c);
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(c);
  let r = null, g = null, b = null;

  if (m3) {
    const h = m3[1];
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (m6) {
    const h = m6[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }

  if (r !== null) {
    const a = Math.max(0, Math.min(1, p / 100));
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return jp2ResolveCssColorToRgba(c, p / 100, scopeEl);
}


function jp2SvgToCurrentColor(svgText) {
  let s = String(svgText || "");
  s = s.replace(/\swidth="[^"]*"/g, "").replace(/\sheight="[^"]*"/g, "");
  s = s.replace(/fill="([^"]+)"/g, (m, v) => {
    const vv = String(v || "").trim().toLowerCase();
    if (vv === "none") return m;
    return 'fill="currentColor"';
  });
  return s;
}

const JP2_AQI_GLOBAL_SVG_RAW = {
  good: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><g fill="none" fill-rule="evenodd"><path d="M0 48h48V0H0z"/><g fill="#718B3A"><path d="M22.579 30.814c.512.148.986.22 1.447.22.46 0 .934-.072 1.447-.22a.378.378 0 0 0 .076-.693.373.373 0 0 0-.284-.03c-.89.257-1.586.257-2.477 0a.377.377 0 0 0-.21.724"/><path d="M40.139 24.513a1.36 1.36 0 0 0-.924-.238c.377-1.81.637-3.614.777-5.363.382-4.79-.863-8.887-3.6-11.849-2.92-3.158-7.437-4.97-12.392-4.97-1.258 0-2.374.124-3.007.242a8.88 8.88 0 0 1-.759-.438l-.051-.035a.19.19 0 0 0-.26.052l-.334.492a.187.187 0 0 0-.03.144c.01.05.04.094.082.12l.054.035c.856.561 1.79.983 2.561 1.157.875.197 1.311.622 1.493.858l.032.04a.19.19 0 0 0 .236.053l.532-.278a.188.188 0 0 0 .065-.277l-.042-.06c-.172-.24-.653-.795-1.595-1.132.342-.019.783-.033 1.023-.033 4.697 0 8.963 1.701 11.701 4.668 2.59 2.807 3.719 6.554 3.353 11.137a43.37 43.37 0 0 1-.944 6.087l-.051.27a.254.254 0 0 0 .247.3h.362a.255.255 0 0 0 .154-.054l.057-.045c.245-.187.546-.236.716-.115.343.242.35 1.053.019 2.064l-.335 1.03-.01.027c-.192.595-.39 1.21-.637 1.943-.389 1.152-1.092 1.899-1.898 2.024l.063-.145c.047-.11.095-.22.142-.336a.255.255 0 0 0-.143-.327l-.408-.16a.255.255 0 0 0-.324.141c-1.775 4.454-3.995 7.823-6.986 10.603-1.625 1.51-3.206 1.82-5.079 1.82-1.872 0-3.453-.31-5.079-1.821-2.992-2.78-5.211-6.149-6.985-10.602a.253.253 0 0 0-.326-.14l-.407.16a.252.252 0 0 0-.141.327c.046.116.094.227.142.338l.06.137c-.014-.002-.027-.003-.04-.006-.796-.146-1.472-.88-1.855-2.013-.243-.718-.438-1.322-.627-1.907l-.354-1.095c-.332-1.01-.325-1.82.018-2.062.175-.123.47-.073.734.129l.067.042c.046.028.1.04.15.038l.357-.024a.222.222 0 0 0 .114-.039c.031.014.087.01.133-.002.351-.088.698-.396.95-.843.41-.727.704-1.79 1.044-3.02.684-2.48 1.537-5.566 3.756-6.964 2.485-1.567 4.625-1.291 7.106-.971 2.38.306 5.074.652 8.572-.574l.08.052c.257 1.897 1.445 4.389 4.016 5.73a.376.376 0 1 0 .347-.668c-2.394-1.249-3.448-3.569-3.636-5.324a.38.38 0 0 0-.172-.278l-.387-.245a.37.37 0 0 0-.33-.037c-3.418 1.24-6.063.898-8.406.595-2.51-.321-4.882-.624-7.592 1.083-2.465 1.553-3.36 4.796-4.08 7.401-.327 1.182-.608 2.203-.973 2.85-.152.269-.312.403-.42.459a42.846 42.846 0 0 1-.89-5.833c-.743-9.32 4.854-13.079 8.257-14.49l.046-.019c.42.184.812.318 1.167.398.875.197 1.312.622 1.494.858l.032.041a.192.192 0 0 0 .236.052l.532-.278a.188.188 0 0 0 .065-.277l-.043-.06c-.209-.29-.832-.998-2.102-1.286-.658-.147-1.473-.518-2.235-1.015l-.05-.034a.188.188 0 0 0-.261.051l-.334.492a.187.187 0 0 0-.03.144c.01.05.04.094.083.122l.053.033c.111.073.226.141.338.207-5.757 2.681-8.739 8.19-8.185 15.136.138 1.736.4 3.54.778 5.363a1.354 1.354 0 0 0-.924.237c-.423.3-1.032 1.102-.37 3.124l.343 1.057c.193.597.393 1.216.641 1.95.668 1.98 2.005 2.685 3.034 2.685.05 0 .1-.005.15-.01l.008-.001c1.733 3.91 3.835 6.934 6.612 9.515 1.959 1.821 3.907 2.072 5.72 2.072 1.812 0 3.76-.25 5.72-2.071 2.776-2.582 4.879-5.606 6.612-9.516h.007c.05.006.101.01.152.01 1.028 0 2.365-.705 3.032-2.683.253-.748.453-1.364.652-1.982l.332-1.025c.664-2.023.054-2.826-.368-3.125"/><path d="M31.026 24.643c0-.515-.689-.935-1.536-.935-.846 0-1.534.42-1.534.935 0 .524.673.934 1.534.934.847 0 1.536-.42 1.536-.934m-12.539.934c.848 0 1.537-.42 1.537-.934 0-.515-.69-.935-1.537-.935-.846 0-1.535.42-1.535.935 0 .524.674.934 1.535.934m9.093 9.999c-.404 1.021-1.388 2.631-3.58 2.631-2.19 0-3.176-1.61-3.58-2.631h7.16zM24 38.96c2.524 0 3.963-1.89 4.467-3.658a.375.375 0 0 0-.362-.48h-8.21a.378.378 0 0 0-.363.48c.505 1.768 1.944 3.658 4.468 3.658zm7.942-16.711a.372.372 0 0 0-.002-.288.373.373 0 0 0-.206-.203 6.035 6.035 0 0 0-2.239-.437c-.959 0-1.752.241-2.249.443a.377.377 0 0 0 .142.725.37.37 0 0 0 .141-.028 5.305 5.305 0 0 1 1.966-.387c.837 0 1.526.208 1.958.383a.38.38 0 0 0 .49-.208m-11.494.211a.375.375 0 0 0 .488-.495.376.376 0 0 0-.205-.202 6.042 6.042 0 0 0-2.249-.442c-.955 0-1.745.238-2.24.438a.377.377 0 0 0 .284.698 5.277 5.277 0 0 1 1.956-.383c.837 0 1.53.21 1.966.386"/></g></g></svg>`,
  warn: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><g fill="none" fill-rule="evenodd"><path d="M0 48h48V0H0z"/><g fill="#B25826"><path d="M22.851 37.65a.377.377 0 0 0 0 .754h2.298a.376.376 0 0 0 0-.753h-2.298zm-.272-6.836c.513.148.986.22 1.448.22.46 0 .934-.072 1.446-.22a.378.378 0 0 0 .076-.693.372.372 0 0 0-.283-.03c-.892.257-1.587.257-2.479 0a.366.366 0 0 0-.283.03.372.372 0 0 0-.182.227.371.371 0 0 0 .032.287.373.373 0 0 0 .225.18m5.363 6.349a.375.375 0 0 0 .374-.418.374.374 0 0 0-.138-.252c-1.143-.92-2.496-1.387-4.025-1.387-1.53 0-2.883.466-4.026 1.387a.374.374 0 0 0-.057.53c.13.16.368.187.53.056 1.004-.81 2.2-1.22 3.553-1.22 1.353 0 2.548.41 3.553 1.22.068.055.15.084.236.084m4.072-14.527a.375.375 0 0 0 .324-.422.382.382 0 0 0-.423-.323c-1.588.21-3.277-.342-4.408-1.445a.378.378 0 0 0-.64.275.38.38 0 0 0 .114.265c1.093 1.065 2.686 1.702 4.262 1.702.259 0 .518-.018.771-.052M21.01 20.454a.373.373 0 0 0-.266-.114h-.004a.374.374 0 0 0-.262.107c-1.13 1.103-2.816 1.658-4.408 1.444a.374.374 0 0 0-.423.324.377.377 0 0 0 .324.422c.254.034.514.052.771.052 1.577 0 3.17-.637 4.263-1.703a.377.377 0 0 0 .005-.532m10.016 4.189c0-.515-.689-.935-1.536-.935-.846 0-1.534.42-1.534.935 0 .524.673.934 1.534.934.847 0 1.536-.42 1.536-.934m-12.539.934c.848 0 1.537-.42 1.537-.934 0-.515-.69-.935-1.537-.935-.846 0-1.534.42-1.534.935 0 .524.674.934 1.534.934"/><path d="M40.139 24.513a1.358 1.358 0 0 0-.924-.238c.377-1.81.637-3.614.777-5.363.382-4.79-.863-8.887-3.6-11.849-2.92-3.158-7.437-4.97-12.392-4.97-1.258 0-2.374.124-3.007.242a8.836 8.836 0 0 1-.759-.438l-.051-.035a.191.191 0 0 0-.26.052l-.334.492a.189.189 0 0 0 .053.265l.053.034c.856.561 1.79.983 2.561 1.157.875.197 1.311.622 1.493.858l.033.041a.19.19 0 0 0 .235.052l.531-.278a.191.191 0 0 0 .066-.278l-.042-.059c-.172-.24-.653-.795-1.595-1.132.342-.019.783-.033 1.022-.033 4.698 0 8.964 1.701 11.702 4.668 2.59 2.807 3.719 6.554 3.353 11.137a43.37 43.37 0 0 1-.944 6.087l-.051.27a.254.254 0 0 0 .247.3h.362a.255.255 0 0 0 .154-.054l.057-.045c.245-.187.546-.236.716-.115.343.242.35 1.053.019 2.064l-.335 1.03-.01.027c-.192.595-.39 1.21-.637 1.943-.389 1.152-1.092 1.899-1.898 2.024l.063-.145c.047-.11.095-.22.142-.336a.255.255 0 0 0-.143-.327l-.408-.16a.255.255 0 0 0-.324.141c-1.775 4.454-3.995 7.823-6.986 10.603-1.625 1.51-3.206 1.82-5.079 1.82-1.873 0-3.453-.31-5.078-1.821-2.993-2.78-5.212-6.15-6.985-10.602a.253.253 0 0 0-.326-.14l-.407.16a.25.25 0 0 0-.142.327c.046.116.094.227.143.338.02.046.04.09.058.137a.45.45 0 0 1-.039-.006c-.796-.146-1.472-.88-1.855-2.014a142.07 142.07 0 0 1-.628-1.911l-.353-1.09c-.333-1.01-.325-1.82.018-2.062.175-.123.47-.072.734.129l.067.042a.251.251 0 0 0 .15.038l.357-.024a.226.226 0 0 0 .114-.039.252.252 0 0 0 .133-.002c.352-.089.698-.396.95-.843.41-.727.704-1.79 1.044-3.019.684-2.48 1.537-5.566 3.756-6.965 2.486-1.568 4.627-1.291 7.106-.971 2.38.306 5.074.652 8.572-.574l.08.052c.257 1.897 1.445 4.389 4.016 5.73a.376.376 0 1 0 .347-.668c-2.394-1.249-3.448-3.569-3.636-5.324a.38.38 0 0 0-.172-.278l-.387-.245a.37.37 0 0 0-.33-.037c-3.418 1.24-6.063.898-8.406.595-2.512-.322-4.881-.625-7.592 1.083-2.466 1.554-3.361 4.796-4.08 7.401-.327 1.182-.608 2.203-.973 2.85-.153.27-.314.404-.42.46a42.807 42.807 0 0 1-.89-5.834c-.743-9.32 4.854-13.079 8.258-14.49a.635.635 0 0 1 .045-.019c.42.184.813.318 1.167.398.876.197 1.312.622 1.494.858l.032.041a.19.19 0 0 0 .236.052l.53-.277a.191.191 0 0 0 .097-.124.184.184 0 0 0-.03-.154l-.043-.06c-.208-.29-.831-.998-2.102-1.286-.658-.147-1.472-.518-2.235-1.015l-.05-.034a.19.19 0 0 0-.261.051l-.334.492a.189.189 0 0 0 .053.266l.053.033c.112.073.226.141.338.207-5.757 2.681-8.74 8.19-8.185 15.136a43.8 43.8 0 0 0 .777 5.363 1.361 1.361 0 0 0-.923.237c-.423.298-1.033 1.102-.37 3.124l.334 1.026c.209.648.402 1.245.65 1.982.668 1.978 2.005 2.684 3.034 2.684.05 0 .1-.005.15-.01l.008-.001c1.733 3.91 3.835 6.935 6.612 9.515 1.959 1.821 3.907 2.072 5.72 2.072 1.812 0 3.76-.25 5.72-2.071 2.776-2.58 4.878-5.605 6.611-9.516h.007c.05.006.101.01.153.01 1.028 0 2.365-.705 3.032-2.683.253-.748.453-1.364.652-1.982l.332-1.025c.664-2.023.054-2.826-.368-3.125"/></g></g></svg>`,
  bad: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><g fill="none" fill-rule="evenodd"><path d="M0 48h48V0H0z"/><g fill="#634675"><path d="M26.22 36.782a2.152 2.152 0 0 1-2.148 2.152 2.152 2.152 0 0 1 0-4.302 2.15 2.15 0 0 1 2.147 2.15m-2.147-2.9a2.9 2.9 0 0 0 0 5.802 2.901 2.901 0 0 0 0-5.802"/><path d="M27.889 36.914A3.696 3.696 0 0 1 24.2 40.61a3.696 3.696 0 0 1 0-7.389 3.695 3.695 0 0 1 3.688 3.694M24.2 32.471a4.445 4.445 0 0 0 0 8.888 4.445 4.445 0 0 0 0-8.888"/><path d="M38.206 36.981a.102.102 0 0 1-.007.08l-4.565 8.86a.104.104 0 0 1-.139.044l-1.017-.526 4.66-9.044 1.017.526a.102.102 0 0 1 .05.06zm-27.431-.06l1.017-.526 4.66 9.045-1.017.525a.107.107 0 0 1-.139-.044l-4.565-8.86a.105.105 0 0 1-.007-.08.105.105 0 0 1 .05-.06zm8.907 6.342c-.125.391-.393.71-.757.898l-1.808.935-4.66-9.044 1.808-.935a1.529 1.529 0 0 1 2.066.66l3.253 6.314c.188.364.223.78.098 1.172zm8.764-.213c-1.378.875-2.732.996-3.99.996-1.253 0-2.601-.12-3.975-.986a2.275 2.275 0 0 0-.232-1.313l-3.254-6.313c-.022-.044-.05-.083-.077-.123l-.018-.026c2.134-3.991 5.75-6.972 7.566-6.976 1.816.004 5.43 2.984 7.565 6.975l-.02.03a.976.976 0 0 0-.076.12l-3.254 6.313c-.205.4-.286.85-.235 1.303zm3.367 2.046l-1.808-.935a1.54 1.54 0 0 1-.659-2.07l3.253-6.314a1.525 1.525 0 0 1 1.364-.832c.246 0 .482.058.702.172l1.808.935-4.398 8.537-.262.507zm8.677-20.407a1.347 1.347 0 0 0-.918-.237c.374-1.802.633-3.597.771-5.337.38-4.767-.856-8.844-3.576-11.791-2.9-3.144-7.388-4.947-12.31-4.947-1.25 0-2.359.124-2.989.24-.29-.151-.53-.29-.753-.435l-.051-.034a.19.19 0 0 0-.258.051l-.332.49a.184.184 0 0 0-.03.141c.01.05.04.095.083.122l.053.034c.85.559 1.777.979 2.543 1.152.87.196 1.303.618 1.484.853l.032.041a.188.188 0 0 0 .234.052l.528-.277a.19.19 0 0 0 .066-.277l-.043-.058c-.17-.239-.648-.79-1.584-1.127.34-.018.778-.033 1.016-.033 4.667 0 8.904 1.694 11.624 4.646 2.574 2.793 3.695 6.522 3.332 11.083a43.229 43.229 0 0 1-.938 6.058l-.05.269a.248.248 0 0 0 .053.206.245.245 0 0 0 .192.091h.36a.255.255 0 0 0 .152-.053l.057-.044c.243-.187.542-.235.711-.115.34.241.348 1.048.02 2.054l-.347 1.066c-.19.588-.386 1.196-.63 1.92-.385 1.146-1.085 1.89-1.884 2.014.02-.05.041-.098.062-.146.047-.109.094-.218.14-.333a.253.253 0 0 0-.141-.325l-.407-.16a.253.253 0 0 0-.321.141c-.382.96-.795 1.884-1.258 2.816l-.023.03-.151-.079a2.256 2.256 0 0 0-1.74-.146c-.26.083-.5.21-.715.378a20.2 20.2 0 0 0-3.814-4.82c-1.611-1.482-3.127-2.3-4.277-2.303-1.143.003-2.66.822-4.27 2.304a20.203 20.203 0 0 0-3.815 4.82 2.263 2.263 0 0 0-.717-.379 2.255 2.255 0 0 0-1.739.146l-.151.078-.063-.078a36.789 36.789 0 0 1-1.238-2.767.25.25 0 0 0-.322-.14l-.406.16a.252.252 0 0 0-.14.326c.044.111.09.218.136.325l.064.147a.46.46 0 0 1-.04-.006c-.79-.145-1.462-.875-1.842-2.004-.24-.71-.433-1.309-.62-1.888l-.356-1.098c-.329-1.006-.321-1.812.02-2.053.173-.123.464-.072.729.128l.066.042a.244.244 0 0 0 .15.038l.354-.023a.235.235 0 0 0 .113-.04.25.25 0 0 0 .132-.002c.35-.088.693-.393.944-.838.408-.724.7-1.78 1.037-3.005.68-2.468 1.526-5.54 3.731-6.932 2.47-1.56 4.597-1.284 7.06-.966 2.365.304 5.04.649 8.516-.57l.08.051c.255 1.888 1.434 4.368 3.99 5.701a.375.375 0 0 0 .344-.664c-2.379-1.242-3.426-3.551-3.613-5.298a.377.377 0 0 0-.17-.276l-.384-.244a.369.369 0 0 0-.328-.037c-3.396 1.234-6.023.894-8.351.592-2.496-.32-4.851-.622-7.543 1.078-2.45 1.545-3.339 4.772-4.054 7.365-.324 1.176-.604 2.192-.967 2.836-.155.276-.318.409-.417.459A42.807 42.807 0 0 1 9.5 19.04c-.739-9.275 4.822-13.015 8.203-14.42l.045-.019c.418.184.808.317 1.16.397.87.196 1.303.619 1.484.853l.032.041a.19.19 0 0 0 .234.052l.527-.276a.19.19 0 0 0 .066-.277l-.042-.059c-.207-.289-.826-.994-2.089-1.28-.653-.147-1.462-.515-2.22-1.01l-.05-.034a.187.187 0 0 0-.259.051l-.332.49a.19.19 0 0 0 .052.263l.053.034c.111.073.225.14.337.205-5.72 2.669-8.683 8.152-8.132 15.063.137 1.73.397 3.526.772 5.337a1.358 1.358 0 0 0-.918.237c-.42.297-1.026 1.097-.366 3.108l.33 1.022c.198.614.396 1.228.647 1.972.663 1.97 1.992 2.671 3.014 2.671.05 0 .098-.005.146-.01h.01c.189.426.397.869.634 1.348l-2.492 1.288a1.044 1.044 0 0 0-.447 1.402l4.566 8.861a1.038 1.038 0 0 0 1.4.448l3.488-1.805c.411-.212.75-.532.986-.928 1.453.805 2.837.916 4.117.916 1.222 0 2.667-.11 4.129-.924.235.4.577.722.991.936l3.49 1.805a1.036 1.036 0 0 0 1.4-.448l4.565-8.86a1.043 1.043 0 0 0-.446-1.403l-2.508-1.295c.233-.472.44-.912.63-1.342l.012.001c.048.005.096.01.146.01 1.021 0 2.35-.702 3.013-2.671.254-.755.459-1.389.647-1.972l.33-1.02c.66-2.014.054-2.813-.365-3.11z"/><path d="M31.938 21.552a.375.375 0 0 0-.374-.376h-4.367a.374.374 0 0 0 0 .75h4.367a.374.374 0 0 0 .374-.374m-3.703 2.673c0 .521.67.929 1.525.929.841 0 1.526-.417 1.526-.929 0-.513-.685-.93-1.526-.93-.84 0-1.525.417-1.525.93m-6.885-2.673a.375.375 0 0 0-.374-.376h-4.367a.374.374 0 0 0 0 .75h4.367a.374.374 0 0 0 .374-.374m-4.409 2.673c0 .521.67.929 1.525.929.841 0 1.526-.417 1.526-.929 0-.513-.685-.93-1.526-.93-.84 0-1.525.417-1.525.93"/></g></g></svg>`,
};

const JP2_AQI_GLOBAL_SVG = (() => {
  const out = {};
  for (const [k, v] of Object.entries(JP2_AQI_GLOBAL_SVG_RAW)) {
    out[k] = jp2SvgToCurrentColor(v);
  }
  out.unknown = out.warn || out.good || "";
  return out;
})();


function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

// -------------------------
// Lovelace actions
// -------------------------
function jp2FireEvent(node, type, detail = {}, options = {}) {
  try {
    node?.dispatchEvent(new CustomEvent(type, {
      detail,
      bubbles: options.bubbles !== false,
      composed: options.composed !== false,
      cancelable: options.cancelable === true,
    }));
  } catch (_) {}
}

function jp2NormalizeActionConfig(actionCfg, fallback) {
  if (actionCfg === undefined || actionCfg === null) return deepClone(fallback || { action: "none" });
  if (typeof actionCfg === "string") return { action: actionCfg };
  if (typeof actionCfg !== "object" || Array.isArray(actionCfg)) return deepClone(fallback || { action: "none" });
  const out = { ...actionCfg };
  if (!out.action && typeof fallback === "object" && fallback?.action) out.action = fallback.action;
  out.action = String(out.action || "none");
  return out;
}

function jp2ActionHasAction(actionCfg) {
  const a = actionCfg && typeof actionCfg === "object" ? String(actionCfg.action || "none") : "none";
  return a && a !== "none";
}

function jp2EventPathHasNoCardAction(ev) {
  try {
    const path = ev?.composedPath?.() || [];
    for (const n of path) {
      if (!n) continue;
      if (n?.dataset && (n.dataset.jp2NoCardAction === "1" || n.dataset.jp2NoCardAction === "true")) return true;
      if (typeof n?.getAttribute === "function" && (n.getAttribute("data-jp2-no-card-action") === "1")) return true;
    }
  } catch (_) {}
  return false;
}

function jp2BindLovelaceActionHandler(targetEl, {
  onAction,
  hasDouble = () => false,
  hasHold = () => false,
  shouldIgnore = () => false,
  holdTime = 500,
  doubleTapTime = 250,
  moveThreshold = 10,
} = {}) {
  if (!targetEl) return;

  let pointerDown = false;
  let startX = 0;
  let startY = 0;
  let holdTimer = null;
  let holdFired = false;
  let pendingTapTimer = null;
  let pendingTapEvent = null;

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  const clearPendingTap = () => { if (pendingTapTimer) { clearTimeout(pendingTapTimer); pendingTapTimer = null; } pendingTapEvent = null; };
  const dist = (x1, y1, x2, y2) => Math.hypot((x1 - x2), (y1 - y2));

  const onPointerDown = (ev) => {
    try {
      if (shouldIgnore(ev)) return;
      if (ev?.button !== undefined && ev.button !== 0) return;
      pointerDown = true;
      holdFired = false;
      startX = ev?.clientX ?? 0;
      startY = ev?.clientY ?? 0;

      clearHold();
      if (hasHold()) {
        holdTimer = setTimeout(() => {
          if (!pointerDown) return;
          holdFired = true;
          clearPendingTap();
          try { onAction?.("hold", ev); } catch (_) {}
        }, holdTime);
      }
    } catch (_) {}
  };

  const onPointerMove = (ev) => {
    try {
      if (!pointerDown) return;
      const x = ev?.clientX ?? 0;
      const y = ev?.clientY ?? 0;
      if (dist(startX, startY, x, y) > moveThreshold) clearHold();
    } catch (_) {}
  };

  const onPointerUp = (ev) => {
    try {
      if (!pointerDown) return;
      pointerDown = false;
      clearHold();

      if (holdFired) {
        try { ev?.preventDefault?.(); } catch (_) {}
        return;
      }

      if (shouldIgnore(ev)) return;

      const doubleEnabled = !!hasDouble();
      if (!doubleEnabled) {
        try { onAction?.("tap", ev); } catch (_) {}
        return;
      }

      if (pendingTapTimer) {
        clearPendingTap();
        try { onAction?.("double_tap", ev); } catch (_) {}
        return;
      }

      pendingTapEvent = ev;
      pendingTapTimer = setTimeout(() => {
        const e = pendingTapEvent;
        clearPendingTap();
        try { onAction?.("tap", e); } catch (_) {}
      }, doubleTapTime);
    } catch (_) {}
  };

  const onPointerCancel = () => { pointerDown = false; clearHold(); };
  const onContextMenu = (ev) => {
    try {
      if (shouldIgnore(ev)) return;
      if (!hasHold()) return;
      ev.preventDefault();
      ev.stopPropagation();
      clearHold();
      clearPendingTap();
      try { onAction?.("hold", ev); } catch (_) {}
    } catch (_) {}
  };

  const onKeyDown = (ev) => {
    try {
      if (shouldIgnore(ev)) return;
      const k = ev?.key;
      if (k === "Enter" || k === " ") {
        ev.preventDefault();
        try { onAction?.("tap", ev); } catch (_) {}
      }
    } catch (_) {}
  };

  targetEl.addEventListener("pointerdown", onPointerDown);
  targetEl.addEventListener("pointermove", onPointerMove);
  targetEl.addEventListener("pointerup", onPointerUp);
  targetEl.addEventListener("pointercancel", onPointerCancel);
  targetEl.addEventListener("contextmenu", onContextMenu);
  targetEl.addEventListener("keydown", onKeyDown);

  return () => {
    try { targetEl.removeEventListener("pointerdown", onPointerDown); } catch (_) {}
    try { targetEl.removeEventListener("pointermove", onPointerMove); } catch (_) {}
    try { targetEl.removeEventListener("pointerup", onPointerUp); } catch (_) {}
    try { targetEl.removeEventListener("pointercancel", onPointerCancel); } catch (_) {}
    try { targetEl.removeEventListener("contextmenu", onContextMenu); } catch (_) {}
    try { targetEl.removeEventListener("keydown", onKeyDown); } catch (_) {}
  };
}


function jp2StableStringify(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") return v;
    if (Array.isArray(v)) return v.map(norm);
    if (t === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return String(v);
  };
  try { return JSON.stringify(norm(value)); }
  catch (_) { try { return JSON.stringify(value); } catch (__) { return String(value); } }
}

function normalizeHaFormSchema(schema) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out = { ...node };
    if (out.path && out.name) {
      out.name = `${out.path}.${out.name}`;
      delete out.path;
    }
    if (Array.isArray(out.schema)) out.schema = out.schema.map(walk);
    return out;
  };
  return walk(schema || []);
}


function jp2GetDeep(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function jp2SetDeep(obj, path, value) {
  if (!obj || typeof obj !== "object") return obj;
  const parts = String(path || "").split(".").filter(Boolean);
  if (parts.length === 0) return obj;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object" || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function jp2NormalizeDottedRootKeys(cfg, rootPrefixes = ["bar"]) {
  if (!cfg || typeof cfg !== "object") return cfg;
  for (const root of rootPrefixes) {
    const prefix = `${root}.`;
    for (const k of Object.keys(cfg)) {
      if (!k || typeof k !== "string") continue;
      if (!k.startsWith(prefix)) continue;
      const sub = k.slice(prefix.length);
      if (!cfg[root] || typeof cfg[root] !== "object" || Array.isArray(cfg[root])) cfg[root] = {};
      const existing = jp2GetDeep(cfg[root], sub);
      if (existing === undefined) jp2SetDeep(cfg[root], sub, cfg[k]);
      delete cfg[k];
    }
  }
  return cfg;
}

function jp2CollectSchemaNames(schema) {
  const names = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    if (typeof node.name === "string" && node.name) names.push(node.name);
    if (Array.isArray(node.schema)) node.schema.forEach(walk);
  };
  walk(schema);
  return names;
}

function jp2BuildHaFormData(normalizedSchema, cfg) {
  const data = deepClone(cfg || {});
  const names = jp2CollectSchemaNames(normalizedSchema || []);
  for (const n of names) {
    if (!n.includes(".")) continue;
    const v = jp2GetDeep(cfg || {}, n);
    if (v !== undefined) data[n] = v;
  }
  return data;
}

function jp2CollapseHaFormValue(value) {
  const v = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === "string" && k.includes(".")) {
      jp2SetDeep(out, k, val);
    } else {
      out[k] = val;
    }
  }
  if (v.bar && typeof v.bar === "object" && !Array.isArray(v.bar)) {
    out.bar = { ...(out.bar || {}), ...v.bar };
  }
  jp2NormalizeDottedRootKeys(out, ["bar"]);
  return out;
}

function normalizeMultiModeConfig(config) {
  const legacyMode = "i" + "q" + "a";
  const legacyPrefix = legacyMode + "_";
  const out = deepClone(config || {});
  if (!out || typeof out !== "object") return {};
  if (String(out.card_mode || "") === legacyMode) out.card_mode = "aqi";
  for (const k of Object.keys(out)) {
    if (k.startsWith(legacyPrefix)) {
      const nk = "aqi_" + k.slice(legacyPrefix.length);
      if (out[nk] === undefined) out[nk] = out[k];
    }
  }
  return out;
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
    if (k === "class") { e.className = v; continue; }
    if (k === "style") {
      if (v && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          if (sk.startsWith("--") || sk.includes("-")) e.style.setProperty(sk, String(sv));
          else e.style[sk] = String(sv);
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
    this._aqiWrap = null;

    this._historyCache = new Map();
    this._historyInflight = new Map();
    this._historyCacheMax = 30;

    this._lastRenderKey = null;
    this._renderRaf = null;

    this._sensorCtx = null;
    this._viz = {
      open: false,
      hours: null,
      smooth: false,
      showThresholds: true,
      showStats: true,
      points: null,
      preset: null,
      entityId: null,
    };
    
    // Optimisation: AbortController pour les fetch history
    this._abortController = null;
    this._resizeObserver = new ResizeObserver(() => {}); 

    this._onGraphClick = this._onGraphClick.bind(this);
    this._onHeaderClick = this._onHeaderClick.bind(this);
    this._onVizKeyDown = this._onVizKeyDown.bind(this);
  }

  disconnectedCallback() {
    if (this._renderRaf) cancelAnimationFrame(this._renderRaf);
    if (this._jp2UnbindActions) this._jp2UnbindActions();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._abortController) this._abortController.abort();
    try { document.removeEventListener("keydown", this._onVizKeyDown); } catch (_) {}
  }
  
  connectedCallback() {
     this._ensureBase();
     if (this._root) this._resizeObserver.observe(this._root);
  }

  static getStubConfig() {
    return {
      card_mode: "sensor",
      entity: "",
      preset: "radon",
      name: DEFAULT_NAME_BY_PRESET.radon,
      icon: DEFAULT_ICON_BY_PRESET.radon,
      background_enabled: false,
      bar_enabled: true,
      show_graph: true,
       tap_action: { action: "more-info" },
       hold_action: { action: "more-info" },
       double_tap_action: { action: "none" },
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
      knob_color_mode: "theme",
      knob_outline_size: 2,
      icon_size: 40,
      icon_inner_size: 22,
      icon_background: true,
      icon_circle: true,
      title_size: 16,
      value_size: 18,
      unit_size: 12,
      secondary_value_size: 12,
      secondary_unit_size: 12,
      secondary_state_size: 12,
      graph_position: "below_top",
      hours_to_show: 24,
      graph_height: 42,
      line_width: 2,
      graph_color_mode: "segments",
      graph_color: "",
      graph_warn_color: "",
      graph_bad_color: "",
      visualizer_enabled: true,
      visualizer_ranges: "6,12,24,72,168",
      visualizer_show_stats: true,
      visualizer_show_thresholds: true,
      visualizer_smooth_default: false,
      bar: { align: "center", width: 92, height: 6, opacity: 100, good: "#45d58e", warn: "#ffb74d", bad: "#ff6363" },
      aqi_title: "AQI",
      aqi_title_icon: "",
      aqi_entities: [],
      aqi_show_title: true,
      aqi_show_global: true,
      aqi_show_sensors: true,
      aqi_air_only: false,
      aqi_global_svg_enabled: false,
      aqi_global_svg_size: 52,
      aqi_global_svg_color_mode: "status",
      aqi_global_svg_color: "",
      aqi_global_svg_show_icon: true,
      aqi_global_svg_background: true,
      aqi_global_svg_background_color_mode: "status",
      aqi_global_svg_background_color: "",
      aqi_global_svg_background_opacity: 12,
      aqi_global_svg_circle: true,
      aqi_global_svg_circle_width: 1,
      aqi_global_svg_circle_color_mode: "status",
      aqi_global_svg_circle_color: "",
      aqi_global_status_enabled: true,
      aqi_global_status_show_dot: true,
      aqi_global_status_show_text: true,
      aqi_global_status_dot_size: 10,
      aqi_global_status_dot_outline: 1,
      aqi_global_status_text_size: 0,
      aqi_global_status_text_weight: 0,
      aqi_background_enabled: false,
      aqi_layout: "vertical",
      aqi_tiles_per_row: 3,
      aqi_tile_color_enabled: false,
      aqi_tile_transparent: false,
      aqi_tile_outline_transparent: false,
      aqi_tile_radius: 16,
      aqi_tiles_icons_only: false,
      aqi_show_sensor_icon: true,
      aqi_show_sensor_name: true,
      aqi_show_sensor_entity: false,
      aqi_show_sensor_value: true,
      aqi_show_sensor_unit: true,
      aqi_show_sensor_status: true,
      aqi_text_name_size: 0,
      aqi_text_name_weight: 0,
      aqi_text_value_size: 0,
      aqi_text_value_weight: 0,
      aqi_text_unit_size: 0,
      aqi_text_unit_weight: 0,
      aqi_text_status_size: 0,
      aqi_text_status_weight: 0,
      aqi_icon_size: 34,
      aqi_icon_inner_size: 18,
      aqi_icon_background: true,
      aqi_icon_circle: true,
      aqi_icon_color_mode: "colored",
      aqi_overrides: {},
    };
  }

  static getConfigElement() {
    return document.createElement("jp2-air-quality-editor");
  }

  static getConfigForm(config = {}) {
    // Note: This static method is a fallback for raw YAML editor in HA
    // The visual editor logic is in Jp2AirQualityCardEditor class
    return { schema: [] };
  }

  setConfig(config) {
    const stub = Jp2AirQualityCard.getStubConfig();
    const raw = normalizeMultiModeConfig(config);
    const merged = {
      ...stub,
      ...raw,
      bar: { ...(stub.bar || {}), ...deepClone((raw && raw.bar) || {}) },
    };

    merged.card_mode = String(merged.card_mode || "sensor");
    merged.preset = String(merged.preset || "radon");
    merged.graph_color_mode = String(merged.graph_color_mode || "segments");
    merged.graph_position = String(merged.graph_position || "below_top");

    merged.visualizer_enabled = merged.visualizer_enabled !== false;
    merged.visualizer_ranges = String(merged.visualizer_ranges ?? "6,12,24,72,168");
    merged.visualizer_show_stats = merged.visualizer_show_stats !== false;
    merged.visualizer_show_thresholds = merged.visualizer_show_thresholds !== false;
    merged.visualizer_smooth_default = !!merged.visualizer_smooth_default;

     merged.tap_action = jp2NormalizeActionConfig(merged.tap_action, { action: "more-info" });
     merged.hold_action = jp2NormalizeActionConfig(merged.hold_action, { action: "more-info" });
     merged.double_tap_action = jp2NormalizeActionConfig(merged.double_tap_action, { action: "none" });

    merged.aqi_layout = String(merged.aqi_layout || "vertical");
    merged.aqi_title_icon = String(merged.aqi_title_icon || "");
    merged.aqi_air_only = !!merged.aqi_air_only;
    merged.aqi_tile_transparent = !!merged.aqi_tile_transparent;
    merged.aqi_entities = Array.isArray(merged.aqi_entities) ? merged.aqi_entities : [];
    merged.aqi_overrides = merged.aqi_overrides && typeof merged.aqi_overrides === "object" ? merged.aqi_overrides : {};

    merged.knob_color_mode = normalizeKnobColorMode(merged);
    if (merged.bar && Object.prototype.hasOwnProperty.call(merged.bar, "knob_color_mode")) delete merged.bar.knob_color_mode;

    merged.aqi_tiles_per_row = clamp(Number(merged.aqi_tiles_per_row || 3), 1, 6);
    merged.aqi_tile_radius = clamp(Number(merged.aqi_tile_radius ?? 16), 0, 40);

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
    
    // Optim: Ne pas re-render si la config n'a pas changé.
    const mode = String(this._config.card_mode || "sensor");
    const key = mode === "aqi" ? this._buildAqiKey(hass) : this._buildSensorKey(hass);
    if (key && key === this._lastRenderKey) return;
    this._lastRenderKey = key;

    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderRaf) cancelAnimationFrame(this._renderRaf);
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = null;
      this._ensureBase(); // ensure DOM is there
      this._render();
    });
  }

  getCardSize() {
    return 3;
  }

  _showError(title, err) {
    const msg = err && (err.message || err.toString()) ? (err.message || err.toString()) : String(err || "");
    try { console.error(`[${CARD_NAME}] ${title}`, err); } catch (_) {}
    try {
      this._root = null;
      this._header = null;
      this._graphWrap = null;
      this._aqiWrap = null;
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding:12px">
            <div style="font-weight:700; color: var(--error-color, #d32f2f);">JP2 Air Quality — ${_jp2EscapeHtml(title)}</div>
            <div style="margin-top:6px; font-size:12px; opacity:.85;">${_jp2EscapeHtml(msg)}</div>
          </div>
        </ha-card>
      `;
    } catch (_) {}
  }

  _buildSensorKey(hass) {
    const c = this._config;
    const eid = c?.entity;
    if (!eid) return "sensor:none";
    const st = hass?.states?.[eid];
    if (!st) return `sensor:${eid}:missing`;
    const u = st.attributes && st.attributes.unit_of_measurement ? st.attributes.unit_of_measurement : "";
    const lu = st.last_updated || st.last_changed || "";
    return `sensor:${eid}:${st.state}:${u}:${lu}`;
  }

  _buildAqiKey(hass) {
    const c = this._config;
    const ents = Array.isArray(c?.aqi_entities) ? c.aqi_entities : [];
    const cfgBits = [
      String(c?.aqi_layout || "vertical"),
      String(c?.aqi_tiles_per_row || ""),
      String(c?.aqi_tile_radius || ""),
      String(!!c?.aqi_tile_color_enabled),
      String(!!c?.aqi_tile_transparent),
      String(!!c?.aqi_tile_outline_transparent),
      String(!!c?.aqi_show_sensors),
      String(!!c?.aqi_show_global),
      String(!!c?.aqi_air_only),
      String(!!c?.aqi_show_title),
      String(c?.aqi_title_icon || ""),
      String(!!c?.aqi_show_sensor_icon),
      String(!!c?.aqi_show_sensor_name),
      String(!!c?.aqi_show_sensor_entity),
      String(!!c?.aqi_show_sensor_value),
      String(!!c?.aqi_show_sensor_unit),
      String(!!c?.aqi_show_sensor_status),
      String(!!c?.aqi_tiles_icons_only),
    ].join("|");

    const parts = [`aqi:${cfgBits}`];
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

    if (p === "custom") {
      const base = jp2DefaultCustomPreset();
      const raw = (this._config && this._config.custom_preset && typeof this._config.custom_preset === "object")
        ? this._config.custom_preset
        : {};

      const num = (v, d) => {
        if (v === "" || v === null || v === undefined) return d;
        const n = Number(v);
        return Number.isFinite(n) ? n : d;
      };
      const str = (v, d) => {
        const s = String(v ?? "").trim();
        return s ? s : d;
      };

      const merged = {
        ...base,
        ...raw,
        decimals: Math.max(0, Math.min(6, Math.round(num(raw.decimals, base.decimals)))),
        min: num(raw.min, base.min),
        max: num(raw.max, base.max),
        good_max: num(raw.good_max, base.good_max),
        warn_max: num(raw.warn_max, base.warn_max),
        warn_low_min: num(raw.warn_low_min, base.warn_low_min),
        good_min: num(raw.good_min, base.good_min),
        good_max_band: num(raw.good_max_band, base.good_max_band),
        warn_high_max: num(raw.warn_high_max, base.warn_high_max),
        unit_fallback: str(raw.unit_fallback, base.unit_fallback),
        label_good: str(raw.label_good, base.label_good),
        label_warn: str(raw.label_warn, base.label_warn),
        label_bad: str(raw.label_bad, base.label_bad),
        type: (String(raw.type || base.type) === "band") ? "band" : "rising",
      };

      if (merged.type === "band") {
        return {
          ...merged,
          good_max: merged.good_max_band,
          warn_max: merged.warn_high_max,
        };
      }
      return merged;
    }

    const common = {
      type: "rising", decimals: 0, unit_fallback: "", min: 0, max: 100, good_max: 0, warn_max: 0,
      warn_low_min: undefined, good_min: undefined, good_max_band: undefined, warn_high_max: undefined,
      label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais",
    };

    const map = {
      radon: { ...common, type: "rising", decimals: 0, unit_fallback: "Bq/m³", min: 0, max: 400, good_max: 99, warn_max: 299, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      co2: { ...common, type: "rising", decimals: 0, unit_fallback: "ppm", min: 400, max: 2000, good_max: 800, warn_max: 1000, label_good: "Bon", label_warn: "À aérer", label_bad: "Élevé" },
      voc: { ...common, type: "rising", decimals: 0, unit_fallback: "ppb", min: 0, max: 3000, good_max: 250, warn_max: 2000, label_good: "Faible", label_warn: "À ventiler", label_bad: "Très élevé" },
      pm1: { ...common, type: "rising", decimals: 1, unit_fallback: "µg/m³", min: 0, max: 100, good_max: 10, warn_max: 25, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      pm25: { ...common, type: "rising", decimals: 1, unit_fallback: "µg/m³", min: 0, max: 150, good_max: 12.0, warn_max: 35.4, label_good: "Bon", label_warn: "Moyen", label_bad: "Mauvais" },
      temperature: { ...common, type: "band", decimals: 1, unit_fallback: "°C", min: 0, max: 35, warn_low_min: 16, good_min: 18, good_max_band: 24, warn_high_max: 26, label_good: "Confort", label_warn: "À surveiller", label_bad: "Alerte" },
      humidity: { ...common, type: "band", decimals: 0, unit_fallback: "%", min: 0, max: 100, warn_low_min: 30, good_min: 40, good_max_band: 60, warn_high_max: 70, label_good: "Confort", label_warn: "À surveiller", label_bad: "Inconfort" },
      pressure: { ...common, type: "band", decimals: 0, unit_fallback: "hPa", min: 950, max: 1050, warn_low_min: 970, good_min: 980, good_max_band: 1030, warn_high_max: 1040, label_good: "Normal", label_warn: "Variable", label_bad: "Extrême" },
    };

    const cfg = map[p] || map.radon;
    if (cfg.type === "band") {
      return {
        ...cfg,
        good_max: cfg.good_max_band,
        warn_max: cfg.warn_high_max,
      };
    }
    return cfg;
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

    if (String(pc.type) === "band") {
      const min = Number(pc.min);
      const max = Number(pc.max);
      const warnLowMin = Number(pc.warn_low_min);
      const goodMin = Number(pc.good_min);
      const goodMax = Number(pc.good_max_band);
      const warnHighMax = Number(pc.warn_high_max);

      const inGood = (v >= goodMin && v <= goodMax);
      const inWarnLow = (v >= warnLowMin && v < goodMin);
      const inWarnHigh = (v > goodMax && v <= warnHighMax);

      if (inGood) { level = "good"; label = pc.label_good; color = colors.good; }
      else if (inWarnLow || inWarnHigh) { level = "warn"; label = pc.label_warn; color = colors.warn; }
      else { level = "bad"; label = pc.label_bad; color = colors.bad; }

      const ratio = (max > min) ? clamp((v - min) / (max - min), 0, 1) : 0;
      return { level, label, color, ratio, preset: String(preset) };
    }

    if (v <= pc.good_max) { level = "good"; label = pc.label_good; color = colors.good; }
    else if (v <= pc.warn_max) { level = "warn"; label = pc.label_warn; color = colors.warn; }

    const ratio = pc.max > pc.min ? clamp((v - pc.min) / (pc.max - pc.min), 0, 1) : 0;
    return { level, label, color, ratio, preset: String(preset) };
  }

  _barSegmentsFor(preset) {
    const pc = this._presetConfig(preset);
    const min = Number(pc.min);
    const max = Number(pc.max);
    const span = max - min;
    const fallback = () => [{ cls: "good", pct: 33.333 }, { cls: "warn", pct: 33.333 }, { cls: "bad", pct: 33.334 }];
    if (!isNum(min) || !isNum(max) || span <= 0) return fallback();

    const pct = (a, b) => clamp(((b - a) / span) * 100, 0, 100);
    let segs = [];

    if (String(pc.type) === "band") {
      const warnLowMin = clamp(Number(pc.warn_low_min), min, max);
      const goodMin = clamp(Number(pc.good_min), min, max);
      const goodMax = clamp(Number(pc.good_max_band), min, max);
      const warnHighMax = clamp(Number(pc.warn_high_max), min, max);
      const stops = [min, warnLowMin, goodMin, goodMax, warnHighMax, max];
      segs = [
        { cls: "bad", from: stops[0], to: stops[1] },
        { cls: "warn", from: stops[1], to: stops[2] },
        { cls: "good", from: stops[2], to: stops[3] },
        { cls: "warn", from: stops[3], to: stops[4] },
        { cls: "bad", from: stops[4], to: stops[5] },
      ].map((s) => ({ cls: s.cls, pct: pct(s.from, s.to) })).filter((s) => s.pct > 0.05);
    } else {
      const goodMax = clamp(Number(pc.good_max), min, max);
      const warnMax = clamp(Number(pc.warn_max), min, max);
      const stops = [min, goodMax, warnMax, max];
      segs = [
        { cls: "good", from: stops[0], to: stops[1] },
        { cls: "warn", from: stops[1], to: stops[2] },
        { cls: "bad", from: stops[2], to: stops[3] },
      ].map((s) => ({ cls: s.cls, pct: pct(s.from, s.to) })).filter((s) => s.pct > 0.05);
    }

    if (!segs.length) return fallback();
    const sum = segs.reduce((a, s) => a + s.pct, 0);
    segs[segs.length - 1].pct = Math.max(0, segs[segs.length - 1].pct + (100 - sum));
    return segs;
  }

  _buildBarInner(preset) {
    const segs = this._barSegmentsFor(preset);
    return el("div", { class: "bar-inner" }, segs.map((s) =>
      el("div", { class: `seg ${s.cls}`, style: { flex: `0 0 ${s.pct.toFixed(3)}%` } })
    ));
  }

  _detectPreset(entityId, stateObj) {
    const id = String(entityId || "").toLowerCase();
    const unitRaw = String(stateObj?.attributes?.unit_of_measurement || "").toLowerCase();
    const unit = unitRaw.replace(/\s/g, "");
    const dc = String(stateObj?.attributes?.device_class || "").toLowerCase();

    if (dc.includes("temperature") || unit === "°c" || unit === "°f" || id.includes("temp") || id.includes("temperature")) return "temperature";
    if (dc.includes("humidity") || unit === "%" || id.includes("humid") || id.includes("humidity")) return "humidity";
    if (dc.includes("pressure") || unit.includes("hpa") || unit.includes("mbar") || unit.endsWith("pa") || id.includes("press") || id.includes("pression")) return "pressure";
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
        ha-card { padding: 12px; transition: background 0.2s ease; will-change: background; }
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

        .bar-wrap { display:flex; width: 100%; align-items:center; justify-content:center; }
        .bar-wrap.left { justify-content:flex-start; }
        .bar-wrap.right { justify-content:flex-end; }
        .bar {
          width: var(--jp2-bar-width, 92%);
          height: var(--jp2-bar-height, 6px);
          border-radius: 999px;
          position: relative;
          overflow: visible;
        }
        .bar.shadow { box-shadow: 0 3px 10px rgba(0,0,0,.25); }
        .bar-inner {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          overflow: hidden;
          background: var(--divider-color, rgba(0,0,0,.12));
          display: flex;
        }
        .bar-inner .seg { height: 100%; flex: 1; opacity: var(--jp2-bar-opacity, 1); }
        .bar-inner .seg.good { background: var(--jp2-good); }
        .bar-inner .seg.warn { background: var(--jp2-warn); }
        .bar-inner .seg.bad { background: var(--jp2-bad); }

        .knob { position:absolute; top: 50%; transform: translate(-50%, -50%); z-index: 2; width: var(--jp2-knob-size, 12px); height: var(--jp2-knob-size, 12px); border-radius:999px; background: var(--jp2-knob-color, var(--primary-color)); transition: left 0.3s ease; }
        .knob.outline { --_o: var(--jp2-knob-outline-size, 2px); box-shadow: 0 0 0 var(--_o) var(--jp2-card-bg, rgba(255,255,255,.95)), 0 0 0 calc(var(--_o) + 1px) rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.35); }
        .knob.shadow { filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }

        .graph { display:none; }
        .graph.show { display:block; }
        .graph.show.clickable { cursor:pointer; }
        .graph.show.clickable:hover { filter: brightness(1.03); }
        .graph svg { width: 100%; height: var(--jp2-graph-height, 42px); display:block; }
        .graph .msg { font-size: 12px; opacity: .7; padding: 6px 0 0; }

        .aqi { display:none; }
        .aqi.show { display:block; }
        .aqi-head { display:flex; align-items:flex-start; justify-content:space-between; gap: 10px; }
        .aqi-global-top-svg { width:100%; display:flex; justify-content:center; margin: 0 0 8px; }
        .aqi-title { font-weight: 800; display:flex; align-items:center; gap: 8px; }
        .aqi-title ha-icon { --mdc-icon-size: 18px; opacity: .9; }
        .aqi-global { font-weight: 700; opacity:.85; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
        .aqi-global-status { display:flex; gap:8px; align-items:center; width:100%; }
        .aqi-global-icon { width: var(--jp2-aqi-global-size, 52px); height: var(--jp2-aqi-global-size, 52px); display:flex; align-items:center; justify-content:center; position:relative; }
        .aqi-global-icon-bg { position:absolute; inset:0; border-radius:999px; background: var(--jp2-aqi-global-bg, var(--primary-color)); opacity: var(--jp2-aqi-global-bg-opacity, .12); }
        .aqi-global-icon-circle { position:absolute; inset:0; border-radius:999px; border: var(--jp2-aqi-global-circle-w, 1px) solid var(--jp2-aqi-global-circle, var(--divider-color, rgba(0,0,0,.12))); opacity: var(--jp2-aqi-global-circle-opacity, 1); }
        .aqi-global-svg { width: 100%; height: 100%; display:flex; align-items:center; justify-content:center; color: var(--jp2-aqi-global-icon, var(--primary-text-color)); }
        .aqi-global-svg svg { width: 78%; height: 78%; display:block; }
        .dot { width:10px; height:10px; border-radius:999px; background: var(--jp2-status-color); box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 2px rgba(0,0,0,.20); }

        .aqi-list { display:flex; flex-direction:column; gap: 8px; margin-top: 8px; }
        .aqi-row { display:flex; align-items:center; gap: 10px; padding: 8px 10px; border-radius: 14px; background: var(--secondary-background-color, rgba(0,0,0,.03)); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
        .aqi-row .meta { min-width:0; flex:1 1 auto; }
        .aqi-row .name { font-weight: var(--jp2-aqi-name-weight, 700); font-size: var(--jp2-aqi-name-size, inherit); line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .aqi-row .entity { font-size: 11px; opacity: .6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .aqi-row .right { text-align:right; flex:0 0 auto; }
        .aqi-row .val { font-weight: var(--jp2-aqi-value-weight, 800); font-size: var(--jp2-aqi-value-size, inherit); }
        .aqi-unit { margin-left: 6px; opacity: .7; font-weight: var(--jp2-aqi-unit-weight, 600); font-size: var(--jp2-aqi-unit-size, inherit); }
        .aqi-row .st { display:flex; justify-content:flex-end; gap:6px; align-items:center; opacity:.85; font-weight: var(--jp2-aqi-status-weight, 600); font-size: var(--jp2-aqi-status-size, inherit); }

        .tiles { display:grid; gap: 10px; margin-top: 10px; grid-template-columns: repeat(var(--jp2-aqi-cols, 3), minmax(0, 1fr)); }
        .tile { padding: 10px; border-radius: var(--jp2-aqi-tile-radius, 16px); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--secondary-background-color, rgba(0,0,0,.03)); display:flex; flex-direction:column; gap: 8px; min-width: 0; }
        .tile.transparent { background: transparent; }
        .tile.outline-transparent { border-color: transparent !important; }
        .tile.icons-only { justify-content:center; align-items:center; gap: 0; padding: 14px; }
        .tile.colored { position:relative; overflow:hidden; border-color: var(--jp2-aqi-tile-border, var(--divider-color, rgba(0,0,0,.12))); }
        .tile.colored::before { content:""; position:absolute; inset:0; border-radius:inherit; background: var(--jp2-aqi-tile-color, var(--primary-color)); opacity:.12; pointer-events:none; }
        .tile.colored > * { position:relative; }
        .tile-top { display:flex; align-items:center; justify-content:space-between; gap: 8px; }
        .tile-name { font-weight: var(--jp2-aqi-name-weight, 800); font-size: var(--jp2-aqi-name-size, inherit); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tile-status { display:flex; gap:6px; align-items:center; font-weight: var(--jp2-aqi-status-weight, 700); font-size: var(--jp2-aqi-status-size, inherit); opacity:.85; }
        .tile-val { font-weight: var(--jp2-aqi-value-weight, 900); font-size: var(--jp2-aqi-value-size, 18px); line-height:1; }
        .tile-unit { font-weight: var(--jp2-aqi-unit-weight, 600); font-size: var(--jp2-aqi-unit-size, 12px); opacity:.7; margin-top:2px; }
        
        .viz-overlay { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.45); z-index: 999; padding: 12px; box-sizing: border-box; }
        .viz-overlay.show { display: flex; }
        .viz { width: min(940px, calc(100vw - 24px)); max-height: calc(100vh - 24px); background: var(--card-background-color, var(--ha-card-background, var(--paper-card-background-color, #fff))); color: var(--primary-text-color); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.12); display: flex; flex-direction: column; will-change: opacity, transform; }
        .viz-head { display:flex; align-items:flex-start; justify-content:space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: rgba(0,0,0,.02); }
        .viz-title { display:flex; flex-direction:column; gap: 2px; min-width: 0; }
        .viz-title .t { display:flex; align-items:center; gap: 10px; font-weight: 900; }
        .viz-title .sub { font-size: 12px; opacity: .75; font-weight: 700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .viz-title .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary-color); box-shadow: 0 0 0 2px rgba(0,0,0,.10); flex: 0 0 auto; }
        .viz-actions { display:flex; gap: 8px; align-items:center; }
        .viz-btn { cursor:pointer; border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 12px; padding: 6px 10px; background: var(--secondary-background-color, rgba(0,0,0,.03)); color: var(--primary-text-color); font-weight: 900; line-height: 1; user-select: none; }
        .viz-btn.icon { width: 36px; height: 36px; padding: 0; display:flex; align-items:center; justify-content:center; }
        .viz-controls { padding: 10px 14px; display:flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
        .viz-chip { cursor:pointer; border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 999px; padding: 6px 10px; background: rgba(0,0,0,.03); font-size: 12px; font-weight: 900; opacity: .95; }
        .viz-chip.active { background: rgba(3,169,244,.18); border-color: rgba(3,169,244,.35); }
        .viz-chip.dim { opacity: .7; font-weight: 800; }
        .viz-body { padding: 12px 14px 14px; display:flex; flex-direction:column; gap: 10px; overflow:auto; }
        .viz-chart-wrap { position: relative; width: 100%; }
        .viz-chart-wrap svg { width: 100%; height: min(42vh, 340px); display:block; border-radius: 14px; background: rgba(0,0,0,.03); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); touch-action: none; }
        .viz-tip { position:absolute; left: 0; top: 0; transform: translate(-50%, -110%); pointer-events: none; padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,.72); color: white; font-size: 12px; font-weight: 800; white-space: nowrap; display: none; z-index: 10; }
        .viz-tip.show { display:block; }
        .viz-stats { display:flex; flex-wrap: wrap; gap: 10px; }
        .stat { flex: 1 1 150px; background: rgba(0,0,0,.03); border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 14px; padding: 10px; }
        .stat .k { font-size: 11px; opacity: .70; font-weight: 900; }
        .stat .v { font-size: 16px; font-weight: 900; margin-top: 2px; }
        @media (max-width: 480px) {
          .viz { width: calc(100vw - 12px); max-height: calc(100vh - 12px); border-radius: 16px; }
          .viz-controls { padding: 10px 12px; }
          .viz-body { padding: 12px; }
        }
      </style>

      <ha-card>
        <div class="wrap" id="wrap">
          <div class="header" id="header"></div>
          <div class="bar-wrap" id="barWrap"></div>
          <div class="graph" id="graph"></div>
          <div class="aqi" id="aqi"></div>
        </div>
      </ha-card>

      <div class="viz-overlay" id="vizOverlay" aria-hidden="true">
        <div class="viz" role="dialog" aria-modal="true" aria-label="Visualisateur d'historique">
          <div class="viz-head">
            <div class="viz-title">
              <div class="t"><span class="dot" id="vizDot"></span><span id="vizTitle">Historique</span></div>
              <div class="sub" id="vizSub"></div>
            </div>
            <div class="viz-actions">
              <button class="viz-btn icon" type="button" id="vizClose" title="Fermer">✕</button>
            </div>
          </div>
          <div class="viz-controls" id="vizControls"></div>
          <div class="viz-body">
            <div class="viz-chart-wrap" id="vizChartWrap">
              <div class="viz-chart" id="vizChart"></div>
              <div class="viz-tip" id="vizTip"></div>
            </div>
            <div class="viz-stats" id="vizStats"></div>
          </div>
        </div>
      </div>
    `;

    this._root = this.shadowRoot.getElementById("wrap");
    this._header = this.shadowRoot.getElementById("header");
    this._graphWrap = this.shadowRoot.getElementById("graph");
    this._aqiWrap = this.shadowRoot.getElementById("aqi");

    try { this._graphWrap?.setAttribute("data-jp2-no-card-action", "1"); } catch (_) {}
    try { this._graphWrap?.addEventListener("click", this._onGraphClick); } catch (_) {}
    this._a11yMakeButton(this._graphWrap, this._onGraphClick);

    try { this._cardEl = this.shadowRoot?.querySelector("ha-card") || null; } catch (_) { this._cardEl = null; }
    this._installCardActionHandlers();

    this._vizOverlayEl = this.shadowRoot.getElementById("vizOverlay");
    this._vizTitleEl = this.shadowRoot.getElementById("vizTitle");
    this._vizSubEl = this.shadowRoot.getElementById("vizSub");
    this._vizDotEl = this.shadowRoot.getElementById("vizDot");
    this._vizControlsEl = this.shadowRoot.getElementById("vizControls");
    this._vizChartEl = this.shadowRoot.getElementById("vizChart");
    this._vizTipEl = this.shadowRoot.getElementById("vizTip");
    this._vizStatsEl = this.shadowRoot.getElementById("vizStats");

    const closeBtn = this.shadowRoot.getElementById("vizClose");
    try { closeBtn?.addEventListener("click", () => this._closeVisualizer()); } catch (_) {}
    try {
      this._vizOverlayEl?.addEventListener("click", (ev) => {
        if (ev?.target === this._vizOverlayEl) this._closeVisualizer();
      });
    } catch (_) {}
  }

  _historyGet(key) {
    try {
      const v = this._historyCache.get(key);
      if (v) {
        this._historyCache.delete(key);
        this._historyCache.set(key, v);
      }
      return v;
    } catch (_) { return null; }
  }

  _historySet(key, value) {
    try {
      if (this._historyCache.has(key)) this._historyCache.delete(key);
      this._historyCache.set(key, value);
      const max = Number(this._historyCacheMax) > 0 ? Number(this._historyCacheMax) : 30;
      while (this._historyCache.size > max) {
        const firstKey = this._historyCache.keys().next().value;
        this._historyCache.delete(firstKey);
      }
    } catch (_) {}
  }

  _installCardActionHandlers() {
    if (this._jp2ActionsBound) return;
    const card = this._cardEl || (this.shadowRoot ? this.shadowRoot.querySelector("ha-card") : null);
    if (!card) return;
    this._jp2ActionsBound = true;

    try { card.setAttribute("data-jp2-actions", "1"); } catch (_) {}

    this._jp2UnbindActions = jp2BindLovelaceActionHandler(card, {
      onAction: (gesture, ev) => this._handleCardGesture(gesture, ev),
      hasDouble: () => jp2ActionHasAction(this._config?.double_tap_action),
      hasHold: () => jp2ActionHasAction(this._config?.hold_action),
      shouldIgnore: (ev) => jp2EventPathHasNoCardAction(ev),
    });
  }

  _handleCardGesture(gesture, ev) {
    const c = this._config || {};
    if (!c) return;

    const map = { tap: "tap_action", hold: "hold_action", double_tap: "double_tap_action" };
    const key = map[String(gesture || "tap")] || "tap_action";
    const actionCfg = jp2NormalizeActionConfig(c[key], { action: "none" });

    const conf = actionCfg?.confirmation;
    if (conf) {
      const msg = (typeof conf === "string") ? conf : (conf && typeof conf === "object" ? (conf.text || conf.message || "Confirmer ?") : "Confirmer ?");
      try { if (!window.confirm(msg)) return; } catch (_) {}
    }

    try { if (actionCfg?.haptic && navigator?.vibrate) navigator.vibrate(10); } catch (_) {}
    this._executeLovelaceAction(actionCfg, ev);
  }

  _getDefaultActionEntityId() {
    const c = this._config || {};
    if (c.entity) return c.entity;
    const ents = Array.isArray(c.aqi_entities) ? c.aqi_entities : [];
    if (String(c.card_mode || "") === "aqi" && ents.length === 1) return ents[0];
    return null;
  }

  _executeLovelaceAction(actionCfg, ev) {
    const hass = this._hass;
    const a = String(actionCfg?.action || "none");
    if (!a || a === "none") return;
    const entityId = actionCfg?.entity || this._getDefaultActionEntityId();

    if (a === "more-info") {
      if (!entityId) return;
      jp2FireEvent(this, "hass-more-info", { entityId });
      return;
    }
    if (a === "toggle") {
      if (!hass || !entityId) return;
      try { hass.callService("homeassistant", "toggle", { entity_id: entityId }); } catch (_) {}
      return;
    }
    if (a === "navigate") {
      const path = String(actionCfg?.navigation_path || "");
      if (!path) return;
      jp2FireEvent(this, "hass-navigate", { navigation_path: path });
      try {
        if (path.startsWith("http")) window.location.assign(path);
        else {
          history.pushState(null, "", path);
          window.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
        }
      } catch (_) {}
      return;
    }
    if (a === "url") {
      const url = String(actionCfg?.url_path || "");
      if (!url) return;
      try { window.open(url, "_blank"); } catch (_) { try { window.location.assign(url); } catch (__) {} }
      return;
    }
    if (a === "perform-action" || a === "call-service") {
      if (!hass) return;
      const svc = String(actionCfg?.perform_action || actionCfg?.service || "");
      const [domain, service] = svc.includes(".") ? svc.split(".", 2) : [null, null];
      if (!domain || !service) return;
      const data = actionCfg?.data || actionCfg?.service_data || {};
      const target = actionCfg?.target;
      try {
        if (target) hass.callService(domain, service, data, target);
        else hass.callService(domain, service, data);
      } catch (_) {}
      return;
    }
    if (a === "fire-dom-event") {
      jp2FireEvent(this, "ll-custom", actionCfg);
      return;
    }
  }

  _updateCardInteractivity() {
    const card = this._cardEl || (this.shadowRoot ? this.shadowRoot.querySelector("ha-card") : null);
    if (!card) return;
    const c = this._config || {};
    const any = jp2ActionHasAction(c.tap_action) || jp2ActionHasAction(c.hold_action) || jp2ActionHasAction(c.double_tap_action);
    if (any) {
      card.style.cursor = "pointer";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
    } else {
      card.style.cursor = "";
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
    }
  }

  _a11yMakeButton(el, onActivate) {
    try {
      if (!el) return;
      if (el.getAttribute("data-jp2-a11y") === "1") return;
      el.setAttribute("data-jp2-a11y", "1");
      el.setAttribute("role", "button");
      if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
      el.addEventListener("keydown", (e) => {
        const k = e?.key;
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          onActivate?.(e);
        }
      });
    } catch (_) {}
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
    try {
      const bg = getComputedStyle(card).backgroundColor || "rgb(255,255,255)";
      card.style.setProperty("--jp2-card-bg", jp2ResolveCssColorToRgba(bg, 0.95, card));
    } catch (_) {}
  }

  _render() {
    if (!this._hass || !this._config) return;
    try {
      const c = this._config;
      const colors = this._colors();
      const card = this.shadowRoot?.querySelector("ha-card");
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
        card.style.setProperty("--jp2-bar-opacity", String(clamp(Number(c.bar?.opacity ?? 100), 0, 100) / 100));
        
        card.style.setProperty("--jp2-knob-size", `${c.knob_size}px`);
        card.style.setProperty("--jp2-knob-outline-size", `${clamp(Number(c.knob_outline_size ?? 2), 0, 10)}px`);
        card.style.setProperty("--jp2-graph-height", `${c.graph_height}px`);
        card.style.setProperty("--jp2-aqi-cols", String(clamp(Number(c.aqi_tiles_per_row || 3), 1, 6)));
        card.style.setProperty("--jp2-aqi-tile-radius", `${clamp(Number(c.aqi_tile_radius ?? 16), 0, 40)}px`);

        // AQI Typo
        const sc = (p, v) => v ? card.style.setProperty(p, `${v}px`) : card.style.removeProperty(p);
        const sw = (p, v) => v ? card.style.setProperty(p, String(v)) : card.style.removeProperty(p);
        sc("--jp2-aqi-name-size", Number(c.aqi_text_name_size || 0));
        sw("--jp2-aqi-name-weight", Number(c.aqi_text_name_weight || 0));
        sc("--jp2-aqi-value-size", Number(c.aqi_text_value_size || 0));
        sw("--jp2-aqi-value-weight", Number(c.aqi_text_value_weight || 0));
        sc("--jp2-aqi-unit-size", Number(c.aqi_text_unit_size || 0));
        sw("--jp2-aqi-unit-weight", Number(c.aqi_text_unit_weight || 0));
        sc("--jp2-aqi-status-size", Number(c.aqi_text_status_size || 0));
        sw("--jp2-aqi-status-weight", Number(c.aqi_text_status_weight || 0));
      }

      this._updateCardInteractivity();

      if (String(c.card_mode) === "aqi") {
        this._renderAQICard();
        if (this._header) this._header.classList.add("hidden");
        const bw = this.shadowRoot ? this.shadowRoot.getElementById("barWrap") : null;
        if (bw) bw.innerHTML = "";
        if (this._graphWrap) this._graphWrap.classList.remove("show");
        return;
      }

      if (this._aqiWrap) this._aqiWrap.classList.remove("show");
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

    const cardEl = this.shadowRoot?.querySelector("ha-card");
    if (cardEl) {
      cardEl.style.setProperty("--jp2-status-color", statusColor);
      cardEl.style.setProperty("--jp2-status-outline", cssColorMix(statusColor, 35));
      const mode = normalizeKnobColorMode(c);
      if (mode === "status") cardEl.style.setProperty("--jp2-knob-color", statusColor);
      else cardEl.style.setProperty("--jp2-knob-color", "var(--primary-color)");
    }

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
    const alignRaw = String(c.bar?.align || "center").toLowerCase();
    let align = (alignRaw === "left" || alignRaw === "start") ? "left" : (alignRaw === "right" || alignRaw === "end") ? "right" : "center";
    barWrap.className = `bar-wrap ${align}`;

    if (c.bar_enabled === false) {
      barWrap.innerHTML = "";
    } else {
      const bar = el("div", { class: `bar ${c.bar?.shadow ? "shadow" : ""}`.trim() });
      if (align === "left") { bar.style.marginLeft = "0"; bar.style.marginRight = "auto"; }
      else if (align === "right") { bar.style.marginLeft = "auto"; bar.style.marginRight = "0"; }
      else { bar.style.marginLeft = "auto"; bar.style.marginRight = "auto"; }
      
      const inner = this._buildBarInner(preset);
      bar.appendChild(inner);

      if (c.show_knob !== false && value !== null) {
        const knob = el("div", { class: `knob ${c.knob_outline ? "outline" : ""} ${c.knob_shadow ? "shadow" : ""}` });
        const pct = (st.ratio * 100);
        knob.style.left = `${pct.toFixed(2)}%`;
        if (pct <= 0.1) knob.style.transform = "translate(0, -50%)";
        else if (pct >= 99.9) knob.style.transform = "translate(-100%, -50%)";
        else knob.style.transform = "translate(-50%, -50%)";
        bar.appendChild(knob);
      }
      barWrap.innerHTML = "";
      barWrap.appendChild(bar);
    }

    this._sensorCtx = { entityId, preset, title: titleText, unit };
    try { this._graphWrap?.setAttribute("title", "Clique pour agrandir l'historique"); } catch (_) {}
    try { this._graphWrap?.classList.toggle("clickable", (this._config?.visualizer_enabled !== false) && (this._config?.show_graph !== false)); } catch (_) {}

    this._renderInternalGraph(entityId, preset);
    this._applyGraphPosition();
  }

  _applyGraphPosition() {
    const c = this._config;
    const pos = String(c.graph_position || "below_top");
    const graph = this._graphWrap;
    const wrap = this._root;
    if (!wrap || !graph) return;
    if (graph.parentElement) graph.parentElement.removeChild(graph);
    if (pos === "top") wrap.insertBefore(graph, this._header);
    else if (pos === "bottom") wrap.appendChild(graph);
    else wrap.insertBefore(graph, this._aqiWrap);
  }

  _onHeaderClick() {
    const c = this._config || {};
    if (String(c.card_mode || "sensor") !== "sensor") return;
    const entityId = c.entity;
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _onGraphClick(ev) {
    const c = this._config || {};
    if (String(c.card_mode || "sensor") !== "sensor") return;
    if (c.show_graph === false) return;
    if (c.visualizer_enabled === false) return;
    if (!this._sensorCtx || !this._sensorCtx.entityId) return;
    try { ev?.preventDefault?.(); ev?.stopPropagation?.(); } catch (_) {}
    this._openVisualizer(this._sensorCtx);
  }

  _openVisualizer(ctx) {
    this._ensureBase();
    if (!this._vizOverlayEl) return;
    const c = this._config || {};
    const entityId = ctx?.entityId || c.entity;
    const preset = String(ctx?.preset || c.preset || "radon");
    const title = String(ctx?.title || c.name || DEFAULT_NAME_BY_PRESET[preset] || "Historique");
    const unit = String(ctx?.unit || "");

    if (!this._viz.open) {
      this._viz.hours = clamp(Number(c.hours_to_show || 24), 1, 168);
      this._viz.smooth = !!c.visualizer_smooth_default;
      this._viz.showThresholds = (c.visualizer_show_thresholds !== false);
      this._viz.showStats = (c.visualizer_show_stats !== false);
    }
    this._viz.open = true;
    this._viz.entityId = entityId;
    this._viz.preset = preset;
    this._viz.title = title;
    this._viz.unit = unit;

    try { this._vizTitleEl.textContent = title; } catch (_) {}
    try {
      const stObj = this._hass?.states?.[entityId];
      const v = stObj ? toNum(stObj.state) : null;
      const st = this._statusFor(preset, v);
      if (this._vizDotEl) this._vizDotEl.style.background = st.color || "var(--primary-color)";
      if (this._vizSubEl) {
        const t = stObj?.last_changed || stObj?.last_updated || "";
        const suffix = unit ? ` ${unit}` : "";
        const valTxt = (v === null) ? "—" : this._formatValue(preset, v) + suffix;
        this._vizSubEl.textContent = `${valTxt} • ${st.label || ""}${t ? ` • ${t}` : ""}`.trim();
      }
    } catch (_) {}

    this._vizOverlayEl.classList.add("show");
    this._vizOverlayEl.setAttribute("aria-hidden", "false");
    try { document.addEventListener("keydown", this._onVizKeyDown); } catch (_) {}
    this._renderVisualizer();
  }

  _closeVisualizer() {
    if (!this._vizOverlayEl) return;
    this._viz.open = false;
    this._viz.points = null;
    this._vizOverlayEl.classList.remove("show");
    this._vizOverlayEl.setAttribute("aria-hidden", "true");
    try { document.removeEventListener("keydown", this._onVizKeyDown); } catch (_) {}
    try { this._vizTipEl?.classList.remove("show"); } catch (_) {}
  }

  _onVizKeyDown(ev) {
    if (!this._viz?.open) return;
    if (ev?.key === "Escape") {
      try { ev.preventDefault(); } catch (_) {}
      this._closeVisualizer();
    }
  }

  async _renderVisualizer() {
    if (!this._viz?.open) return;
    const { entityId, preset, unit } = this._viz;
    const c = this._config || {};
    const ranges = jp2ParseHourRanges(c.visualizer_ranges, "6,12,24,72,168");
    const hours = clamp(Number(this._viz.hours || c.hours_to_show || 24), 1, 168);

    if (this._vizControlsEl) {
      this._vizControlsEl.innerHTML = "";
      for (const h of ranges) {
        const chip = el("div", { class: `viz-chip ${h === hours ? "active" : ""}`, role: "button", tabindex: "0", title: `Afficher ${jp2FormatHourLabel(h)}`, onclick: () => { this._viz.hours = h; this._renderVisualizer(); } }, [jp2FormatHourLabel(h)]);
        this._vizControlsEl.appendChild(chip);
      }
      const addToggle = (label, active, onClick) => {
        const chip = el("div", { class: `viz-chip dim ${active ? "active" : ""}`, role: "button", tabindex: "0", onclick: onClick }, [label]);
        this._vizControlsEl.appendChild(chip);
      };
      addToggle("Lissé", !!this._viz.smooth, () => { this._viz.smooth = !this._viz.smooth; this._renderVisualizer(); });
      addToggle("Seuils", !!this._viz.showThresholds, () => { this._viz.showThresholds = !this._viz.showThresholds; this._renderVisualizer(); });
      addToggle("Stats", !!this._viz.showStats, () => { this._viz.showStats = !this._viz.showStats; this._renderVisualizer(); });
    }

    if (this._vizChartEl) this._vizChartEl.innerHTML = `<div class="msg" style="padding:10px; font-size:12px; opacity:.75;">Chargement…</div>`;
    if (this._vizStatsEl) this._vizStatsEl.innerHTML = "";

    const rawPoints = await this._getHistoryPoints(entityId, hours);
    // Si viz fermé ou requête annulée, on stop
    if (!this._viz?.open || !rawPoints) return;

    if (rawPoints.length < 2) {
      if (this._vizChartEl) this._vizChartEl.innerHTML = `<div class="msg" style="padding:10px; font-size:12px; opacity:.75;">Historique indisponible</div>`;
      return;
    }

    const extracted = [];
    for (const p of rawPoints) {
      const v = toNum(p?.state);
      if (v === null) continue;
      extracted.push({ v, t: jp2BestTimestamp(p), raw: p });
    }

    const MAX_PTS = 600;
    const step = Math.max(1, Math.ceil(extracted.length / MAX_PTS));
    const ds = extracted.filter((_, i) => (i % step === 0) || (i === extracted.length - 1));

    const now = Date.now();
    const t0 = ds[0]?.t ?? (now - hours * 3600 * 1000);
    const t1 = ds[ds.length - 1]?.t ?? now;
    const hasTime = (t0 && t1 && t1 > t0);

    let series = ds.map((p) => ({ ...p }));
    if (this._viz.smooth && series.length > 3) {
      series = series.map((p, i) => {
        const a = series[Math.max(0, i - 1)].v;
        const b = series[i].v;
        const c2 = series[Math.min(series.length - 1, i + 1)].v;
        return { ...p, v: (a + b + c2) / 3 };
      });
    }

    const pc = this._presetConfig(preset);
    const ys = series.map((p) => p.v);
    const minY = isNum(pc.min) ? pc.min : Math.min(...ys);
    const maxY = isNum(pc.max) ? pc.max : Math.max(...ys);
    const pad = (maxY - minY) * 0.06 || 1;
    const y0 = minY - pad;
    const y1 = maxY + pad;

    const W = 1000;
    const H = 300;

    const points = series.map((p, i) => {
      const tt = hasTime ? (p.t != null ? p.t : (t0 + (i / (series.length - 1)) * (t1 - t0))) : (t0 + (i / (series.length - 1)) * (t1 - t0));
      const x = (t1 > t0) ? ((tt - t0) / (t1 - t0)) * W : (i / (series.length - 1)) * W;
      const y = H - ((p.v - y0) / (y1 - y0)) * H;
      return { x, y, v: p.v, t: tt };
    });

    const colors = this._colors();
    const baseColor = c.graph_color || "var(--primary-color)";
    const warnColor = c.graph_warn_color || colors.warn;
    const badColor = c.graph_bad_color || colors.bad;

    const thresholdLines = [];
    if (this._viz.showThresholds) {
      const mkLine = (val, label) => {
        const y = H - ((val - y0) / (y1 - y0)) * H;
        if (!Number.isFinite(y)) return;
        thresholdLines.push(`<line x1="0" y1="${y.toFixed(2)}" x2="${W}" y2="${y.toFixed(2)}" stroke="${cssColorMix("var(--divider-color)", 70)}" stroke-width="1" stroke-dasharray="4 5" />`);
        thresholdLines.push(`<text x="${(W - 6)}" y="${(y - 6).toFixed(2)}" text-anchor="end" font-size="12" font-weight="800" fill="${cssColorMix("var(--secondary-text-color)", 10)}">${_jp2EscapeHtml(label)}</text>`);
      };
      if (String(pc.type) === "band") {
        if (isNum(pc.warn_low_min)) mkLine(pc.warn_low_min, `warn ${pc.warn_low_min}`);
        if (isNum(pc.good_min)) mkLine(pc.good_min, `good ${pc.good_min}`);
        if (isNum(pc.good_max_band)) mkLine(pc.good_max_band, `good ${pc.good_max_band}`);
        if (isNum(pc.warn_high_max)) mkLine(pc.warn_high_max, `warn ${pc.warn_high_max}`);
      } else {
        if (isNum(pc.good_max)) mkLine(pc.good_max, `good ${pc.good_max}`);
        if (isNum(pc.warn_max)) mkLine(pc.warn_max, `warn ${pc.warn_max}`);
      }
    }

    const mode = String(c.graph_color_mode || "segments");
    const segPaths = [];
    
    if (mode === "single") {
      const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
      segPaths.push(`<path d="${d}" fill="none" stroke="${baseColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`);
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const st = this._statusFor(preset, (a.v + b.v) / 2);
        const col = st.level === "warn" ? warnColor : st.level === "bad" ? badColor : baseColor;
        segPaths.push(`<path d="M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`);
      }
      if (mode === "peaks") {
        for (const p of points) {
          const st = this._statusFor(preset, p.v);
          if (st.level === "warn" || st.level === "bad") {
            const col = st.level === "warn" ? warnColor : badColor;
            segPaths.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${col}" opacity="0.95" />`);
          }
        }
      }
    }

    const svg = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Historique détaillé">
        <defs>
          <linearGradient id="jp2VizFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${baseColor}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="${baseColor}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${thresholdLines.join("")}
        <path d="${points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")} L ${W} ${H} L 0 ${H} Z" fill="url(#jp2VizFill)" opacity="1" />
        ${segPaths.join("")}
        <line id="vizCursorLine" x1="0" y1="0" x2="0" y2="${H}" stroke="rgba(0,0,0,.25)" stroke-width="1" style="display:none" />
        <circle id="vizCursorDot" cx="0" cy="0" r="5" fill="${baseColor}" stroke="rgba(255,255,255,.8)" stroke-width="2" style="display:none" />
      </svg>
    `;

    if (this._vizChartEl) {
      this._vizChartEl.innerHTML = svg;
      const svgEl = this._vizChartEl.querySelector("svg");
      if (svgEl) {
        this._viz.points = points;
        svgEl.addEventListener("pointermove", (ev) => this._onVizPointerMove(ev, svgEl, W, H, unit, preset));
        svgEl.addEventListener("pointerdown", (ev) => this._onVizPointerMove(ev, svgEl, W, H, unit, preset));
        svgEl.addEventListener("pointerleave", () => this._hideVizTip(svgEl));
      }
    }

    if (this._vizStatsEl && this._viz.showStats) {
      const first = points[0];
      const last = points[points.length - 1];
      const minV = Math.min(...points.map((p) => p.v));
      const maxV = Math.max(...points.map((p) => p.v));
      const avgV = points.reduce((a, p) => a + p.v, 0) / points.length;
      const delta = last.v - first.v;
      const suffix = unit ? ` ${unit}` : "";
      const fmt = (v) => this._formatValue(preset, v) + suffix;

      this._vizStatsEl.innerHTML = "";
      [
        { k: "Actuel", v: fmt(last.v) },
        { k: "Min", v: fmt(minV) },
        { k: "Max", v: fmt(maxV) },
        { k: "Moyenne", v: fmt(avgV) },
        { k: "Δ", v: (delta >= 0 ? "+" : "") + this._formatValue(preset, delta) + suffix },
      ].forEach(it => {
        this._vizStatsEl.appendChild(el("div", { class: "stat" }, [el("div", { class: "k" }, [it.k]), el("div", { class: "v" }, [it.v])]));
      });
    }
  }

  _hideVizTip(svgEl) {
    try {
      const line = svgEl?.querySelector("#vizCursorLine");
      const dot = svgEl?.querySelector("#vizCursorDot");
      if (line) line.style.display = "none";
      if (dot) dot.style.display = "none";
    } catch (_) {}
    try { this._vizTipEl?.classList.remove("show"); } catch (_) {}
  }

  _onVizPointerMove(ev, svgEl, W, H, unit, preset) {
    if (!this._viz?.open || !this._viz?.points || !this._vizTipEl) return;
    const pts = this._viz.points;
    if (!pts.length) return;

    const rect = svgEl.getBoundingClientRect();
    const xPx = clamp((ev.clientX - rect.left), 0, rect.width);
    const xSvg = (rect.width > 0) ? (xPx / rect.width) * W : 0;

    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 6) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x < xSvg) lo = mid;
      else hi = mid;
    }
    let best = lo;
    let bestDist = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = Math.abs(pts[i].x - xSvg);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    const p = pts[best];

    try {
      const line = svgEl.querySelector("#vizCursorLine");
      const dot = svgEl.querySelector("#vizCursorDot");
      if (line) {
        line.setAttribute("x1", p.x.toFixed(2));
        line.setAttribute("x2", p.x.toFixed(2));
        line.style.display = "";
      }
      if (dot) {
        dot.setAttribute("cx", p.x.toFixed(2));
        dot.setAttribute("cy", p.y.toFixed(2));
        const st = this._statusFor(preset, p.v);
        dot.setAttribute("fill", st.color || "var(--primary-color)");
        dot.style.display = "";
      }
    } catch (_) {}

    const locale = this._hass?.locale?.language || navigator.language || "fr-FR";
    const dt = new Date(p.t);
    const isLong = (Number(this._viz.hours || 0) >= 48);
    const dtTxt = isLong
      ? dt.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : dt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

    const suffix = unit ? ` ${unit}` : "";
    const valTxt = this._formatValue(preset, p.v) + suffix;
    const st = this._statusFor(preset, p.v);

    this._vizTipEl.textContent = `${valTxt} • ${st.label || ""} • ${dtTxt}`.trim();
    const yPx = (rect.height > 0) ? (p.y / H) * rect.height : 0;
    const tipX = clamp(xPx, 42, rect.width - 42);
    const tipY = clamp(yPx, 26, rect.height - 20);
    this._vizTipEl.style.left = `${tipX}px`;
    this._vizTipEl.style.top = `${tipY}px`;
    this._vizTipEl.classList.add("show");
  }

  _formatValue(preset, value) {
    const pc = this._presetConfig(preset);
    const dec = Number(pc.decimals ?? 0);
    try {
      if (this._hass && this._hass.locale) {
          return new Intl.NumberFormat(this._hass.locale.language, { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(Number(value));
      }
      return Number(value).toFixed(dec);
    } catch (_) { return String(value); }
  }

  async _getHistoryPoints(entityId, hours) {
    if (!this._hass || !entityId) return null;
    const key = `${entityId}|${hours}`;
    const now = Date.now();
    const cached = this._historyGet(key);
    if (cached && now - cached.ts < 60000) return cached.points;
    if (this._historyInflight.has(key)) return await this._historyInflight.get(key);

    if (this._abortController) this._abortController.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    const p = (async () => {
      try {
        const start = new Date(Date.now() - hours * 3600000).toISOString();
        const url = `history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response`;
        
        // Note: callApi might not support signal in older HA versions, but it's safe to pass extras
        // We check signal.aborted manually after await
        const res = await this._hass.callApi("GET", url);
        if (signal.aborted) throw new Error("Aborted");

        const arr = Array.isArray(res) ? res[0] : null;
        const points = Array.isArray(arr) ? arr : [];
        this._historySet(key, { ts: Date.now(), points });
        return points;
      } catch (e) {
        if (e.message === "Aborted") return null;
        return null;
      } finally {
        this._historyInflight.delete(key);
        if (this._abortController && this._abortController.signal === signal) this._abortController = null;
      }
    })();

    this._historyInflight.set(key, p);
    return await p;
  }

  async _renderInternalGraph(entityId, preset) {
    const c = this._config;
    const graph = this._graphWrap;
    if (!graph) return;

    const enabled = c.show_graph !== false;
    graph.classList.toggle("show", !!enabled);
    if (!enabled) { graph.innerHTML = ""; return; }

    graph.innerHTML = `<div class="msg">Chargement...</div>`;

    const hours = clamp(Number(c.hours_to_show || 24), 1, 168);
    const points = await this._getHistoryPoints(entityId, hours);
    // Vérification post-await: si l'élément n'est plus connecté, stop
    if (!this.isConnected || !graph) return;

    if (!points || points.length < 2) {
      graph.innerHTML = `<div class="msg">Historique indisponible</div>`;
      return;
    }

    const extracted = [];
    const total = points.length;
    const nowT = Date.now();
    const startT = nowT - hours * 3600000;
    const spanT = Math.max(1, nowT - startT);
    
    for (let i = 0; i < total; i++) {
        const p = points[i];
        const v = toNum(p.state);
        if (v === null) continue;
        let t = jp2BestTimestamp(p);
        if (!isNum(t)) t = startT + (total > 1 ? (i / (total - 1)) * spanT : 0);
        extracted.push({ v, t });
    }

    const MAXP = 220;
    const step = Math.max(1, Math.ceil(extracted.length / MAXP));
    const ds = extracted.filter((_, i) => i % step === 0 || i === extracted.length - 1);
    
    if (ds.length < 2) {
         graph.innerHTML = `<div class="msg">Historique indisponible</div>`;
         return;
    }

    const w = 400, h = 100;
    const t0 = ds[0].t, t1 = ds[ds.length-1].t;
    const tSpan = Math.max(1, t1 - t0);

    const pc = this._presetConfig(preset);
    const ys = ds.map(p => p.v);
    const minY = isNum(pc.min) ? pc.min : Math.min(...ys);
    const maxY = isNum(pc.max) ? pc.max : Math.max(...ys);
    const pad = (maxY - minY) * 0.05 || 1;
    const y0 = minY - pad, y1 = maxY + pad;

    const xy = ds.map(p => ({
       x: ((p.t - t0) / tSpan) * w,
       y: h - ((p.v - y0) / (y1 - y0)) * h,
       v: p.v
    }));

    const colors = this._colors();
    const baseColor = c.graph_color || "var(--primary-color)";
    const warnColor = c.graph_warn_color || colors.warn;
    const badColor = c.graph_bad_color || colors.bad;
    const mode = String(c.graph_color_mode || "segments");
    const strokeW = clamp(Number(c.line_width || 2), 1, 8);

    const svgParts = [`<line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="${cssColorMix("var(--divider-color)", 60, this._cardEl)}" stroke-width="1" />`];
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
         svgParts.push(`<path d="M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />`);
       }
    }
    
    // Utilisation de requestAnimationFrame pour l'écriture DOM
    requestAnimationFrame(() => {
        if (!this.isConnected || !graph) return;
        graph.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Historique">${svgParts.join("")}</svg>`;
    });
  }

  _jp2NormAqiIconColorMode(raw) {
    if (raw === false || raw === 0) return "transparent";
    const v = String(raw ?? "colored").trim().toLowerCase();
    if (v.includes("transparent") || v.includes("theme")) return "transparent";
    return "colored";
  }

  _jp2NormAqiColorMode(raw) {
    const v = String(raw ?? "status").trim().toLowerCase();
    if (v.includes("custom") || v.includes("perso")) return "custom";
    return "status";
  }

  _jp2PickAqiColor(mode, customColor, statusColor) {
    const m = this._jp2NormAqiColorMode(mode);
    return (m === "custom" && customColor) ? customColor : statusColor;
  }

  _buildAqiGlobalSvg(level, statusColor) {
    const c = this._config || {};
    if (!c.aqi_global_svg_enabled) return null;
    const l = (level === "good" || level === "warn" || level === "bad") ? level : "unknown";
    const svg = (JP2_AQI_GLOBAL_SVG && JP2_AQI_GLOBAL_SVG[l]) ? JP2_AQI_GLOBAL_SVG[l] : (JP2_AQI_GLOBAL_SVG?.unknown || "");
    if (!svg) return null;

    const size = clamp(Number(c.aqi_global_svg_size ?? 52), 18, 140);
    const iconColor = this._jp2PickAqiColor(c.aqi_global_svg_color_mode, c.aqi_global_svg_color, statusColor);

    const wrap = el("div", { class: "aqi-global-icon", style: { width: `${size}px`, height: `${size}px`, "--jp2-aqi-global-size": `${size}px` } });

    if (c.aqi_global_svg_background !== false) {
      const bgColor = this._jp2PickAqiColor(c.aqi_global_svg_background_color_mode, c.aqi_global_svg_background_color, statusColor);
      const bgOp = clamp(Number(c.aqi_global_svg_background_opacity ?? 12), 0, 100) / 100;
      wrap.appendChild(el("div", { class: "aqi-global-icon-bg", style: { background: bgColor, opacity: String(bgOp) } }));
    }

    if (c.aqi_global_svg_circle !== false) {
      let circleColor = this._jp2PickAqiColor(c.aqi_global_svg_circle_color_mode, c.aqi_global_svg_circle_color, statusColor);
      let circleOpacity = 1;
      const mode = this._jp2NormAqiColorMode(c.aqi_global_svg_circle_color_mode);
      if (mode === "status" && !c.aqi_global_svg_circle_color) {
         const outline = cssColorMix(statusColor, 35);
         if (outline && outline !== "transparent") circleColor = outline;
         else { circleColor = statusColor; circleOpacity = 0.35; }
      }
      const w = clamp(Number(c.aqi_global_svg_circle_width ?? 1), 0, 10);
      wrap.appendChild(el("div", { class: "aqi-global-icon-circle", style: { borderColor: circleColor, borderWidth: `${w}px`, opacity: String(circleOpacity) } }));
    }

    if (c.aqi_global_svg_show_icon !== false) {
      const holder = el("div", { class: "aqi-global-svg", style: { color: iconColor } });
      holder.innerHTML = svg;
      const svgEl = holder.querySelector("svg");
      if (svgEl) { svgEl.setAttribute("aria-hidden", "true"); svgEl.style.pointerEvents = "none"; }
      wrap.appendChild(holder);
    }
    return wrap;
  }

  _renderAQICard() {
    const c = this._config;
    const aqi = this._aqiWrap;
    if (!aqi) return;

    const entities = Array.isArray(c.aqi_entities) ? c.aqi_entities : [];
    aqi.classList.toggle("show", true);
    const rows = [];
    const levelRank = { unknown: -1, good: 0, warn: 1, bad: 2 };
    const airOnly = !!c.aqi_air_only;
    const AIR_PRESETS = new Set(["co2", "voc", "pm1", "pm25", "radon"]);

    let worst = null;
    let worstScore = -9999;

    for (const eid of entities) {
      const stObj = this._hass?.states?.[eid];
      if (!stObj) continue;
      const preset = this._detectPreset(eid, stObj);
      const value = toNum(stObj.state);
      const unit = stObj.attributes?.unit_of_measurement || this._presetConfig(preset).unit_fallback || "";
      const st = this._statusFor(preset, value);
      const ov = c.aqi_overrides?.[eid] || {};
      const icon = ov.icon || DEFAULT_ICON_BY_PRESET[preset] || "mdi:information";
      const iconSize = clamp(Number(c.aqi_icon_size), 16, 80);
      const innerSize = clamp(Number(c.aqi_icon_inner_size), 10, 60);
      const name = (ov.name && String(ov.name).trim()) ? String(ov.name).trim() : (stObj.attributes?.friendly_name || eid);

      rows.push({ eid, name, value, unit, status: st, preset, icon, iconSize, innerSize });

      const considerForGlobal = (!airOnly) || AIR_PRESETS.has(String(preset));
      if (considerForGlobal) {
        const rank = (levelRank[st.level] ?? -1);
        const severity = isNum(st.ratio) ? st.ratio : 0;
        const score = (rank < 0) ? -9999 : (rank * 1000 + Math.round(severity * 999));
        if (score > worstScore) { worstScore = score; worst = { eid, name, preset, status: st }; }
      }
    }

    const globalLevel = worst?.status?.level || "unknown";
    const globalLabel = worst?.status?.label || "—";
    const globalColor = worst?.status?.color || "var(--secondary-text-color)";
    const bgEnabled = !!c.aqi_background_enabled && globalLevel !== "unknown";
    this._setCardBackground(globalColor, bgEnabled);

    const titleEl = (c.aqi_show_title === false) ? null : (() => {
      const kids = [];
      if (c.aqi_title_icon) kids.push(el("ha-icon", { icon: c.aqi_title_icon }));
      kids.push(el("span", {}, [c.aqi_title || "AQI"]));
      return el("div", { class: "aqi-title" }, kids);
    })();

    const showGlobal = (c.aqi_show_global !== false);
    const alignMap = { left: "flex-start", center: "center", right: "flex-end" };
    const svgPos = String(c.aqi_global_svg_position || "global");
    const svgJustify = alignMap[String(c.aqi_global_svg_align || "center")] || "center";

    const _svgEl = this._buildAqiGlobalSvg(globalLevel, globalColor);
    const svgTopEl = (!showGlobal || !_svgEl || svgPos !== "center") ? null : el("div", { class: "aqi-global-top-svg", style: { justifyContent: svgJustify } }, [_svgEl]);
    const svgInGlobal = (!showGlobal || !_svgEl || svgPos === "center") ? null : _svgEl;

    const statusEnabled = (c.aqi_global_status_enabled !== false);
    const dotSize = clamp(Number(c.aqi_global_status_dot_size ?? 10), 4, 30);
    const globalStatusEl = (!showGlobal || !statusEnabled) ? null : el("div", { class: "aqi-global-status", style: { justifyContent: svgJustify } }, [
      c.aqi_global_status_show_dot !== false ? el("span", { class: "dot", style: { background: globalColor, width: `${dotSize}px`, height: `${dotSize}px` } }) : null,
      c.aqi_global_status_show_text !== false ? el("span", {}, [globalLabel]) : null,
    ]);

    const globalEl = (!showGlobal || (!svgInGlobal && !globalStatusEl)) ? null : el("div", { class: "aqi-global", style: { alignItems: svgJustify } }, [svgInGlobal, globalStatusEl]);
    const head = el("div", { class: "aqi-head" }, [titleEl, globalEl]);

    const layout = String(c.aqi_layout || "vertical");
    const iconsOnly = (layout === "horizontal") && !!c.aqi_tiles_icons_only;
    const showIconBg = c.aqi_icon_background !== false;
    const iconColorMode = this._jp2NormAqiIconColorMode(c.aqi_icon_color_mode);

    let body = null;
    if (c.aqi_show_sensors === false) {
      body = el("div", { style: { marginTop: "6px", opacity: ".65", fontSize: "12px" } }, ["(capteurs masqués)"]);
    } else if (layout === "horizontal") {
      body = el("div", { class: "tiles" }, rows.map((r) => {
        const tile = el("div", { class: `tile ${c.aqi_tile_color_enabled ? "colored" : ""} ${c.aqi_tile_transparent ? "transparent" : ""} ${c.aqi_tile_outline_transparent ? "outline-transparent" : ""} ${iconsOnly ? "icons-only" : ""}` });
        const col = r.status.color;
        tile.style.setProperty("--jp2-aqi-tile-color", col);
        const _b = cssColorMix(col, 32);
        tile.style.setProperty("--jp2-aqi-tile-border", c.aqi_tile_outline_transparent ? "transparent" : (_b === "transparent" ? col : _b));

        const iconWrap = el("div", { class: "icon-wrap", style: { width: `${r.iconSize}px`, height: `${r.iconSize}px`, "--jp2-status-color": col, "--jp2-status-outline": cssColorMix(col, 35) } }, [
          showIconBg ? el("div", { class: "icon-bg", style: { background: col } }) : null,
          c.aqi_icon_circle !== false ? el("div", { class: "icon-circle" }) : null,
          el("ha-icon", { icon: r.icon, style: (iconColorMode === "colored") ? `--mdc-icon-size:${r.innerSize}px; color:${col};` : `--mdc-icon-size:${r.innerSize}px; opacity: .75;` }),
        ]);

        const topLeft = el("div", { style: { display: "flex", alignItems: "center", gap: "10px", minWidth: "0" } }, [
          c.aqi_show_sensor_icon === false ? null : iconWrap,
          el("div", { style: { minWidth: "0", flex: "1 1 auto" } }, [
            c.aqi_show_sensor_name === false ? null : el("div", { class: "tile-name" }, [r.name]),
            c.aqi_show_sensor_entity ? el("div", { class: "entity" }, [r.eid]) : null,
          ]),
        ]);

        const statusEl = c.aqi_show_sensor_status === false ? null : el("div", { class: "tile-status" }, [
          el("span", { class: "dot", style: { background: col } }),
          el("span", {}, [r.status.label]),
        ]);

        const val = (c.aqi_show_sensor_value === false && c.aqi_show_sensor_unit === false) ? null : el("div", {}, [
          c.aqi_show_sensor_value === false ? null : el("div", { class: "tile-val" }, [r.value !== null ? this._formatValue(r.preset, r.value) : "—"]),
          c.aqi_show_sensor_unit === false ? null : el("div", { class: "tile-unit" }, [r.unit]),
        ]);

        if (iconsOnly) { tile.title = r.name; tile.appendChild(iconWrap); }
        else { tile.appendChild(el("div", { class: "tile-top" }, [topLeft, statusEl])); if (val) tile.appendChild(val); }
        
        tile.onclick = (e) => { e.stopPropagation(); jp2FireEvent(this, "hass-more-info", { entityId: r.eid }); };
        this._a11yMakeButton(tile, () => jp2FireEvent(this, "hass-more-info", { entityId: r.eid }));
        return tile;
      }));
    } else {
      body = el("div", { class: "aqi-list" }, rows.map((r) => {
        const row = el("div", { class: "aqi-row" });
        const col = r.status.color;
        const iconWrap = el("div", { class: "icon-wrap", style: { width: `${r.iconSize}px`, height: `${r.iconSize}px`, "--jp2-status-color": col, "--jp2-status-outline": cssColorMix(col, 35) } }, [
          showIconBg ? el("div", { class: "icon-bg", style: { background: col } }) : null,
          c.aqi_icon_circle !== false ? el("div", { class: "icon-circle" }) : null,
          el("ha-icon", { icon: r.icon, style: (iconColorMode === "colored") ? `--mdc-icon-size:${r.innerSize}px; color:${col};` : `--mdc-icon-size:${r.innerSize}px; opacity: .75;` }),
        ]);

        if (c.aqi_show_sensor_icon !== false) row.appendChild(iconWrap);
        row.appendChild(el("div", { class: "meta" }, [
          c.aqi_show_sensor_name === false ? null : el("div", { class: "name" }, [r.name]),
          c.aqi_show_sensor_entity ? el("div", { class: "entity" }, [r.eid]) : null,
        ]));
        
        const right = el("div", { class: "right" }, []);
        if (c.aqi_show_sensor_value !== false || c.aqi_show_sensor_unit !== false) {
          right.appendChild(el("div", { class: "val" }, [
            c.aqi_show_sensor_value === false ? null : document.createTextNode(r.value !== null ? this._formatValue(r.preset, r.value) : "—"),
            c.aqi_show_sensor_unit === false ? null : el("span", { class: "aqi-unit" }, [r.unit]),
          ]));
        }
        if (c.aqi_show_sensor_status !== false) {
          right.appendChild(el("div", { class: "st" }, [el("span", { class: "dot", style: { background: col } }), el("span", {}, [r.status.label])]));
        }
        row.appendChild(right);
        row.onclick = (e) => { e.stopPropagation(); jp2FireEvent(this, "hass-more-info", { entityId: r.eid }); };
        this._a11yMakeButton(row, () => jp2FireEvent(this, "hass-more-info", { entityId: r.eid }));
        return row;
      }));
    }

    aqi.innerHTML = "";
    if (svgTopEl) aqi.appendChild(svgTopEl);
    aqi.appendChild(head);
    if (body) aqi.appendChild(body);
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
    this._secOpenState = Object.create(null);
    this._ovOpenState = Object.create(null);
    this._onFormValueChanged = this._onFormValueChanged.bind(this);
  }

  set hass(hass) {
    this._hass = hass;
    for (const f of Array.from(this.shadowRoot?.querySelectorAll("ha-form") || [])) { try { f.hass = hass; } catch (_) {} }
    for (const a of Array.from(this.shadowRoot?.querySelectorAll("hui-action-editor") || [])) { try { a.hass = hass; } catch (_) {} }
  }

  setConfig(config) {
    const stub = Jp2AirQualityCard.getStubConfig();
    const raw = normalizeMultiModeConfig(config);
    const merged = { ...stub, ...raw, bar: { ...(stub.bar || {}), ...deepClone((raw && raw.bar) || {}) } };
    merged.type = (raw && raw.type) ? raw.type : (config && config.type ? config.type : (merged.type || `custom:${CARD_TYPE}`));

    // Nettoyage structurel
    jp2NormalizeDottedRootKeys(merged, ["bar"]);
    if (merged.preset === "custom" && !merged.custom_preset) merged.custom_preset = jp2DefaultCustomPreset();

    const incomingStr = jp2StableStringify(merged);
    this._config = merged;
    this._ensureUI();

    if (this._uiReady && this._lastFiredConfigStr && incomingStr === this._lastFiredConfigStr) {
      this._lastRenderedConfigStr = incomingStr;
      return;
    }
    if (this._uiReady && this._lastRenderedConfigStr && incomingStr === this._lastRenderedConfigStr) return;

    this._render();
    this._lastRenderedConfigStr = incomingStr;
  }

  get _isAqi() { return String(this._config?.card_mode || "sensor") === "aqi"; }

  _ensureUI() {
    if (this._uiReady) return;
    this._uiReady = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .wrap { padding: 12px; display:flex; flex-direction:column; gap: 12px; }
        .hero { border-radius: 18px; padding: 14px 14px 12px; background: linear-gradient(135deg, rgba(3,169,244,.18), rgba(76,175,80,.10)); border: 1px solid rgba(255,255,255,.06); }
        .hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap: 12px; }
        .title { font-size: 15px; font-weight: 800; letter-spacing: .2px; }
        .subtitle { margin-top: 2px; font-size: 12px; opacity: .75; }
        .badge { display:inline-flex; align-items:center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: rgba(0,0,0,.08); font-size: 12px; font-weight: 700; user-select:none; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color); }
        .tabs { display:flex; gap: 8px; overflow:auto; padding-bottom: 2px; scrollbar-width: thin; }
        .tab { border: 1px solid rgba(0,0,0,.10); background: rgba(0,0,0,.03); color: var(--primary-text-color); border-radius: 999px; padding: 8px 12px; font-weight: 700; font-size: 12px; white-space: nowrap; cursor: pointer; transition: all .12s ease; will-change: transform, background; }
        .tab:hover { background: rgba(0,0,0,.06); }
        .tab.active { background: rgba(3,169,244,.18); border-color: rgba(3,169,244,.35); }
        .content { display:flex; flex-direction:column; gap: 12px; }
        .card { border-radius: 18px; overflow: hidden; border: 1px solid rgba(0,0,0,.08); background: var(--card-background-color, var(--ha-card-background, var(--paper-card-background-color, #fff))); }
        .card-head { padding: 12px 14px 10px; display:flex; align-items:flex-start; justify-content:space-between; gap: 10px; border-bottom: 1px solid rgba(0,0,0,.06); }
        .card-head .h { font-weight: 800; }
        .card-head .p { font-size: 12px; opacity: .7; margin-top: 2px; }
        .card-body { padding: 12px 14px 14px; }
        .sec-sum { cursor:pointer; user-select:none; background:none; border:0; width:100%; text-align:left; color: inherit; font: inherit; }
        .sec-chev { opacity: .65; font-size: 18px; line-height: 1; transition: transform .16s ease; will-change: transform; padding-top: 2px; }
        .sec.open .sec-chev { transform: rotate(180deg); }
        ha-form { display:block; }
        .reorder-list { display:flex; flex-direction:column; gap: 8px; margin-top: 8px; }
        .reorder-row { display:flex; align-items:center; justify-content:space-between; gap: 10px; padding: 8px 10px; border-radius: 14px; background: rgba(0,0,0,.03); border: 1px solid rgba(0,0,0,.10); }
        .mini-btn { border: 1px solid rgba(0,0,0,.18); background: rgba(0,0,0,.04); border-radius: 10px; padding: 6px 8px; font-weight: 900; cursor: pointer; line-height: 1; }
        .ov-list { display:flex; flex-direction:column; gap: 10px; }
        .ov { border: 1px solid rgba(0,0,0,.08); border-radius: 16px; background: rgba(0,0,0,.02); overflow:hidden; }
        .ov.open { background: rgba(0,0,0,.03); }
        .ov-sum { background:none; border: 0; width: 100%; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 10px 12px; display:flex; align-items:center; justify-content:space-between; gap: 10px; }
        .ov-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; align-items:start; }
        .footer { font-size: 12px; opacity: .65; padding: 2px 2px 0; }
      </style>
      <div class="wrap">
        <div class="hero">
          <div class="hero-top">
            <div><div class="title">${CARD_NAME}</div><div class="subtitle">Éditeur v${CARD_VERSION}</div></div>
            <div class="badge" id="modeBadge"><span class="dot"></span><span id="modeText">—</span></div>
          </div>
          <div class="tabs" id="tabs"></div>
        </div>
        <div class="content" id="content"></div>
        <div class="footer">Mode code disponible via le menu "..." si nécessaire.</div>
      </div>
    `;
    this.shadowRoot.getElementById("tabs").addEventListener("click", (ev) => {
      const btn = ev.composedPath().find(n => n.dataset && n.dataset.tab);
      if (btn && btn.dataset.tab !== this._tab) { this._tab = btn.dataset.tab; this._render(); }
    });
  }

  _render() {
    if (!this._config) return;
    // Capture state
    for (const d of Array.from(this.shadowRoot.querySelectorAll(".sec[data-sec-id]"))) this._secOpenState[d.dataset.secId] = d.classList.contains("open");
    for (const d of Array.from(this.shadowRoot.querySelectorAll(".ov[data-eid]"))) this._ovOpenState[d.dataset.eid] = d.classList.contains("open");

    const tabs = this._isAqi
      ? [{ id: "general", label: "Général" }, { id: "aqi_entities", label: "Entités" }, { id: "aqi_layout", label: "Style" }, { id: "aqi_overrides", label: "Overrides" }]
      : [{ id: "general", label: "Général" }, { id: "display", label: "Affichage" }, { id: "bar", label: "Barre" }, { id: "graph", label: "Graphe" }, { id: "colors", label: "Couleurs" }];
    
    if (!tabs.some(t => t.id === this._tab)) this._tab = "general";
    
    const tabsEl = this.shadowRoot.getElementById("tabs");
    tabsEl.innerHTML = "";
    tabs.forEach(t => {
      const b = document.createElement("button");
      b.className = `tab ${this._tab === t.id ? "active" : ""}`;
      b.dataset.tab = t.id;
      b.textContent = t.label;
      tabsEl.appendChild(b);
    });

    const isAqi = this._isAqi;
    this.shadowRoot.getElementById("modeText").textContent = isAqi ? "AQI (Multi)" : "Capteur (Simple)";
    this.shadowRoot.querySelector(".dot").style.background = isAqi ? "rgba(76,175,80,.9)" : "rgba(3,169,244,.9)";

    const content = this.shadowRoot.getElementById("content");
    content.innerHTML = "";
    content.appendChild(this._renderTabContent(this._tab));
    
    for (const f of Array.from(this.shadowRoot.querySelectorAll("ha-form"))) f.hass = this._hass;
    this._lastRenderedConfigStr = jp2StableStringify(this._config);
  }

  _renderTabContent(tabId) {
    const root = document.createElement("div");
    root.style.display = "contents";
    const c = this._config;

    if (!this._isAqi) {
      if (tabId === "general") {
         root.appendChild(this._section("Configuration", "Type de carte, entité et preset.", this._makeForm(this._schemaSensorGeneral(), c), "s.gen"));
         if (c.preset === "custom") root.appendChild(this._section("Preset Perso", "Seuils manuels", this._makeForm(this._schemaCustomPreset(), c), "s.custom"));
         root.appendChild(this._section("Interactions", "Actions au clic", this._actionsEditorBody(), "s.act"));
      } else if (tabId === "display") {
         root.appendChild(this._section("Affichage", "Visibilité des éléments", this._makeForm(this._schemaSensorDisplay(), c), "s.disp"));
      } else if (tabId === "graph") {
         root.appendChild(this._section("Graphe", "Historique interne", this._makeForm(this._schemaSensorGraph(), c), "s.graph"));
      } else if (tabId === "bar") {
         root.appendChild(this._section("Barre", "Style de la jauge", this._makeForm(this._schemaSensorBar(), c), "s.bar"));
      } else if (tabId === "colors") {
         root.appendChild(this._section("Couleurs", "Overrides des couleurs", this._makeForm(this._schemaSensorColors(), c), "s.col"));
      }
      return root;
    }

    // AQI
    if (tabId === "general") {
        root.appendChild(this._section("Général", "Options principales AQI", this._makeForm(this._schemaAqiGeneral(), c), "a.gen"));
        root.appendChild(this._section("Icône Global", "SVG au-dessus du statut", this._makeForm(this._schemaAqiGlobalSvg(), c), "a.svg"));
        root.appendChild(this._section("Statut Global", "Texte et point", this._makeForm(this._schemaAqiGlobalStatus(), c), "a.stat"));
    } else if (tabId === "aqi_entities") {
        root.appendChild(this._section("Entités", "Sélection et ordre", this._aqiEntitiesEditor(), "a.ent"));
        root.appendChild(this._section("Interactions", "Actions globales", this._actionsEditorBody(), "a.act"));
    } else if (tabId === "aqi_layout") {
        root.appendChild(this._section("Disposition", "Liste ou Tuiles", this._makeForm(this._schemaAqiLayout(), c), "a.lay"));
        root.appendChild(this._section("Contenu", "Éléments affichés par capteur", this._makeForm(this._schemaAqiRowDisplay(), c), "a.row"));
        root.appendChild(this._section("Typo & Icônes", "Tailles et styles", this._makeForm([...this._schemaAqiTypography(), ...this._schemaAqiIconStyle()], c), "a.sty"));
    } else if (tabId === "aqi_overrides") {
        root.appendChild(this._section("Overrides", "Personnalisation par entité", this._overridesEditor(), "a.ov"));
    }
    return root;
  }

  _section(title, sub, bodyEl, id) {
    const wrap = document.createElement("div");
    wrap.className = "card sec";
    wrap.dataset.secId = id;
    const isOpen = this._secOpenState[id] !== false; // Open by default or remembered
    if (isOpen) wrap.classList.add("open");

    const head = document.createElement("button");
    head.className = "card-head sec-sum";
    head.innerHTML = `<div><div class="h">${title}</div><div class="p">${sub}</div></div><span class="sec-chev">▾</span>`;
    
    const body = document.createElement("div");
    body.className = "card-body";
    body.hidden = !isOpen;
    body.appendChild(bodyEl);

    head.onclick = () => {
       const n = !wrap.classList.contains("open");
       wrap.classList.toggle("open", n);
       body.hidden = !n;
       this._secOpenState[id] = n;
    };
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  _makeForm(schema, data) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    const norm = normalizeHaFormSchema(schema);
    form.schema = norm;
    form.data = jp2BuildHaFormData(norm, data);
    form.computeLabel = (s) => s.name.split('.').pop(); // Simplified label
    form.addEventListener("value-changed", this._onFormValueChanged);
    return form;
  }
  
  _onFormValueChanged(ev) {
      const collapsed = jp2CollapseHaFormValue(ev.detail.value);
      const next = { ...this._config, ...collapsed, bar: { ...(this._config.bar || {}), ...((collapsed && collapsed.bar) || {}) } };
      jp2NormalizeDottedRootKeys(next, ["bar"]);
      
      // Defaults enforcement
      if (next.preset === "custom" && !next.custom_preset) next.custom_preset = jp2DefaultCustomPreset();
      
      this._config = next;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
          this._raf = null;
          this._fireConfigChanged(this._config);
          // Only re-render if structure changed
          if (this._config.card_mode !== next.card_mode || this._config.preset !== next.preset) this._render();
      });
  }
  
  _fireConfigChanged(cfg) {
      const cleaned = deepClone(cfg);
      if (!cleaned.type) cleaned.type = `custom:${CARD_TYPE}`;
      jp2NormalizeDottedRootKeys(cleaned, ["bar"]);
      this._lastFiredConfigStr = jp2StableStringify(cleaned);
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cleaned }, bubbles: true, composed: true }));
  }

  // Schema definitions (compacted)
  _schemaSensorGeneral() { return [
      { name: "card_mode", selector: { select: { options: [{label:"Capteur",value:"sensor"},{label:"AQI Multi",value:"aqi"}], mode:"dropdown" } } },
      { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
      { name: "preset", selector: { select: { options: ["radon","pressure","humidity","temperature","voc","pm1","pm25","co2","custom"].map(v=>({label:v,value:v})), mode:"dropdown" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "background_enabled", selector: { boolean: {} } },
  ];}
  _schemaCustomPreset() { return [
      { name: "custom_preset.type", selector: { select: { options: [{label:"Seuils",value:"rising"},{label:"Zone",value:"band"}], mode:"dropdown"} } },
      { name: "custom_preset.unit_fallback", selector: { text: {} } },
      { type:"grid", schema:[ {name:"custom_preset.min", selector:{number:{}}}, {name:"custom_preset.max", selector:{number:{}}} ]},
      { type:"grid", schema:[ {name:"custom_preset.good_max", selector:{number:{}}}, {name:"custom_preset.warn_max", selector:{number:{}}} ]},
      { type:"grid", schema:[ {name:"custom_preset.label_good", selector:{text:{}}}, {name:"custom_preset.label_warn", selector:{text:{}}}, {name:"custom_preset.label_bad", selector:{text:{}}} ]},
  ];}
  _schemaSensorDisplay() { return [ { type:"grid", schema: ["show_top","show_title","show_secondary","show_icon","show_value","show_unit","show_knob","knob_outline","knob_shadow","icon_background","icon_circle"].map(n => ({name:n, selector:{boolean:{}}})) } ]; }
  _schemaSensorGraph() { return [ { name:"hours_to_show", selector:{number:{min:1,max:168}} }, { name:"graph_height", selector:{number:{min:20,max:150}} }, {name:"graph_color_mode", selector:{select:{options:["single","peaks","segments"].map(v=>({label:v,value:v})), mode:"dropdown"}}}, {name:"visualizer_enabled", selector:{boolean:{}}} ]; }
  _schemaSensorBar() { return [ {type:"grid", schema: ["bar_enabled","show_knob"].map(n=>({name:n, selector:{boolean:{}}}))}, {name:"width", path:"bar", selector:{number:{min:50,max:100}}}, {name:"height", path:"bar", selector:{number:{min:4,max:20}}} ]; }
  _schemaSensorColors() { return [{type:"grid", schema: ["good","warn","bad"].map(n=>({name:n, path:"bar", selector:{text:{}}})) }]; }
  
  _schemaAqiGeneral() { return [ {name:"card_mode", selector:{select:{options:[{label:"Capteur",value:"sensor"},{label:"AQI Multi",value:"aqi"}], mode:"dropdown"}}}, {name:"aqi_title", selector:{text:{}}}, {name:"aqi_title_icon", selector:{icon:{}}}, {name:"aqi_show_global", selector:{boolean:{}}} ]; }
  _schemaAqiGlobalSvg() { return [{name:"aqi_global_svg_enabled", selector:{boolean:{}}}, {name:"aqi_global_svg_size", selector:{number:{min:20,max:100}}}]; }
  _schemaAqiGlobalStatus() { return [{name:"aqi_global_status_enabled", selector:{boolean:{}}}, {name:"aqi_global_status_show_dot", selector:{boolean:{}}}, {name:"aqi_global_status_show_text", selector:{boolean:{}}}]; }
  _schemaAqiLayout() { return [{name:"aqi_layout", selector:{select:{options:["vertical","horizontal"], mode:"dropdown"}}}, {name:"aqi_tiles_per_row", selector:{number:{min:1,max:6}}}]; }
  _schemaAqiRowDisplay() { return [{type:"grid", schema:["aqi_show_sensor_icon","aqi_show_sensor_name","aqi_show_sensor_value","aqi_show_sensor_status"].map(n=>({name:n, selector:{boolean:{}}}))}]; }
  _schemaAqiTypography() { return [{type:"grid", schema:["aqi_text_name_size","aqi_text_value_size","aqi_text_status_size"].map(n=>({name:n, selector:{number:{min:0,max:40}}}))}]; }
  _schemaAqiIconStyle() { return [{name:"aqi_icon_color_mode", selector:{select:{options:["colored","transparent"], mode:"dropdown"}}}]; }

  _aqiEntitiesEditor() {
      const wrap = document.createElement("div");
      wrap.style.display = "grid"; wrap.style.gap = "12px";
      wrap.appendChild(this._makeForm([{name:"aqi_entities", selector:{entity:{domain:"sensor",multiple:true}}}], this._config));
      
      const ents = this._config.aqi_entities || [];
      if(ents.length > 1) {
          const reorder = document.createElement("div");
          reorder.innerHTML = "<b>Ordre d'affichage</b>";
          ents.forEach((eid, idx) => {
              const r = document.createElement("div");
              r.className = "reorder-row";
              r.innerHTML = `<span>${eid}</span><div style="display:flex;gap:4px"><button class="mini-btn up">↑</button><button class="mini-btn down">↓</button></div>`;
              r.querySelector(".up").onclick = () => this._moveAqiEntity(idx, -1);
              r.querySelector(".down").onclick = () => this._moveAqiEntity(idx, 1);
              reorder.appendChild(r);
          });
          wrap.appendChild(reorder);
      }
      return wrap;
  }
  
  _moveAqiEntity(idx, delta) {
      const ents = [...(this._config.aqi_entities || [])];
      const j = idx + delta;
      if (j < 0 || j >= ents.length) return;
      [ents[idx], ents[j]] = [ents[j], ents[idx]];
      this._config = { ...this._config, aqi_entities: ents };
      this._fireConfigChanged(this._config);
      this._render();
  }

  _overridesEditor() {
      const wrap = document.createElement("div");
      wrap.className = "ov-list";
      const ents = this._config.aqi_entities || [];
      const ovs = this._config.aqi_overrides || {};
      
      if (!ents.length) return el("div", {}, ["Aucune entité sélectionnée."]);

      ents.forEach(eid => {
         const det = document.createElement("div");
         det.className = "ov";
         det.dataset.eid = eid;
         const isOpen = this._ovOpenState[eid] === true;
         if (isOpen) det.classList.add("open");
         
         const cur = ovs[eid] || {};
         const head = document.createElement("button");
         head.className = "ov-sum";
         head.innerHTML = `<span>${eid}</span><span class="sec-chev">▾</span>`;
         head.onclick = () => { det.classList.toggle("open"); this._ovOpenState[eid] = det.classList.contains("open"); };
         
         const body = document.createElement("div");
         body.className = "ov-grid";
         body.style.padding = "10px";
         
         const nameF = document.createElement("ha-textfield"); nameF.label = "Nom"; nameF.value = cur.name || "";
         nameF.onchange = (e) => this._setOverride(eid, "name", e.target.value);
         
         const iconF = document.createElement("ha-icon-picker"); iconF.label = "Icône"; iconF.value = cur.icon || "";
         iconF.addEventListener("value-changed", (e) => this._setOverride(eid, "icon", e.detail.value));
         
         body.appendChild(nameF); body.appendChild(iconF);
         det.appendChild(head); det.appendChild(body);
         wrap.appendChild(det);
      });
      return wrap;
  }
  
  _setOverride(eid, key, val) {
      const next = deepClone(this._config);
      if(!next.aqi_overrides) next.aqi_overrides = {};
      if(!next.aqi_overrides[eid]) next.aqi_overrides[eid] = {};
      
      if(!val) delete next.aqi_overrides[eid][key];
      else next.aqi_overrides[eid][key] = val;
      
      this._config = next;
      this._fireConfigChanged(this._config);
  }

  _actionsEditorBody() {
     const wrap = document.createElement("div");
     wrap.style.display = "grid"; wrap.style.gap = "12px";
     ["tap_action","hold_action"].forEach(k => {
         const ed = document.createElement("hui-action-editor");
         ed.label = k.replace("_"," ");
         ed.hass = this._hass;
         ed.config = this._config[k];
         ed.addEventListener("value-changed", (e) => {
             const next = { ...this._config };
             next[k] = e.detail.value;
             this._config = next;
             this._fireConfigChanged(next);
         });
         wrap.appendChild(ed);
     });
     return wrap;
  }
}

// Register
try {
  if (!customElements.get("jp2-air-quality-editor")) customElements.define("jp2-air-quality-editor", Jp2AirQualityCardEditor);
  if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, Jp2AirQualityCard);
  // Compat alias
  if (!customElements.get("jp2-air-quality-card")) customElements.define("jp2-air-quality-card", Jp2AirQualityCard);
  
  window.customCards = window.customCards || [];
  const meta = { type: CARD_TYPE, name: CARD_NAME, description: CARD_DESC, version: CARD_VERSION };
  if(!window.customCards.some(c => c.type === CARD_TYPE)) window.customCards.push(meta);

  console.info(`%c ${CARD_NAME} %c v${CARD_VERSION} (${CARD_BUILD_DATE}) `, "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4; background: white; font-weight: 700;");
} catch (e) { console.warn("JP2 Card registration failed", e); }
