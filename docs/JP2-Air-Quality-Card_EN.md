# JP2 Air Quality Card

> **Version**: v2.0.10 (build 2026-02-15)  
> **Lovelace type**: `custom:jp2-air-quality` *(alias: `custom:jp2-air-quality-card`)*  
> **File**: **`jp2-air-quality.js`** *(the filename must stay exactly the same)*

This Home Assistant card displays an “air quality” sensor in two modes:

- **`sensor` mode**: a card for **one sensor** (radon, CO₂, TVOC, PM, temperature, humidity, pressure…).  
  It computes a **status** (*good / warn / bad*) via **presets** (built-in thresholds), shows a **threshold bar** + a **knob**, and a **mini history graph** (via Home Assistant History API).
- **`aqi` mode**: an “AQI” card that aggregates **multiple sensors** (vertical list or horizontal tiles), computes a **global status** (the “worst” sensor wins), and supports per-sensor **overrides**.

---

## Installation

### 1) Copy the file
Place `jp2-air-quality.js` in your HA `www` folder, typically:

- `/config/www/jp2-air-quality.js`

### 2) Add the Lovelace resource
In Home Assistant: **Settings → Dashboards → Resources**:

- URL: `/local/jp2-air-quality.js`
- Type: **Module**

### 3) Add the card to Lovelace
In a dashboard, add a “Manual” card (or use the visual editor):

```yaml
type: custom:jp2-air-quality
entity: sensor.my_sensor
preset: co2
name: Air quality (CO₂)
```

> Tip: the visual editor is built-in (`jp2-air-quality-editor`). You can configure most options without writing YAML.

---

## Card modes

### `sensor` mode (default)

Displays one sensor + status + bar + history.

**Minimal config:**
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
```

### `aqi` mode

Aggregates a list of sensors.

**Minimal config:**
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_entities:
  - sensor.co2_livingroom
  - sensor.tvoc_livingroom
  - sensor.pm25_livingroom
  - sensor.temperature_livingroom
  - sensor.humidity_livingroom
```

---

## Built‑in presets

Presets provide:
- a **profile** (`rising` or `band`),
- a **unit fallback** (if the sensor has no unit),
- a **min/max range** (scales the bar + graph),
- **thresholds** and **labels**.

### Available presets

| Preset | Profile | Unit | Min → Max | Thresholds | Labels |
|---|---|---:|---:|---|---|
| `radon` | `rising` | Bq/m³ | 0 → 400 | good ≤ 99 ; warn ≤ 299 ; else bad | Good / Warn / Bad |
| `co2` | `rising` | ppm | 400 → 2000 | good ≤ 800 ; warn ≤ 1000 ; else bad | Good / Ventilate / High |
| `voc` | `rising` | ppb | 0 → 3000 | good ≤ 250 ; warn ≤ 2000 ; else bad | Low / Ventilate / Very high |
| `pm1` | `rising` | µg/m³ | 0 → 100 | good ≤ 10 ; warn ≤ 25 ; else bad | Good / Warn / Bad |
| `pm25` | `rising` | µg/m³ | 0 → 150 | good ≤ 12.0 ; warn ≤ 35.4 ; else bad | Good / Warn / Bad |
| `temperature` | `band` | °C | 0 → 35 | bad <16 ; warn 16–18 ; good 18–24 ; warn 24–26 ; bad >26 | Comfort / Watch / Alert |
| `humidity` | `band` | % | 0 → 100 | bad <30 ; warn 30–40 ; good 40–60 ; warn 60–70 ; bad >70 | Comfort / Watch / Uncomfortable |
| `pressure` | `band` | hPa | 950 → 1050 | bad <970 ; warn 970–980 ; good 980–1030 ; warn 1030–1040 ; bad >1040 | Normal / Variable / Extreme |

### Auto-detection (especially useful in `aqi` mode)

In `aqi` mode, the card attempts to **detect a preset** using:
- `device_class` (temperature, humidity, pressure, CO₂, VOC…),
- unit (`ppm`, `ppb`, `°C`, `%`, `hPa`, `µg/m³`, `Bq/m³`),
- entity name (contains `co2`, `tvoc`, `pm25`, `radon`, `temp`, `humid`, etc.)

---

## Custom preset (free sensor)

If your sensor does not match a built-in preset (or you want your own thresholds):

- set `preset: custom`
- configure `custom_preset`.

> In the editor, when **Configuration → Preset → “Custom (free sensor)”** is selected (label may appear as “Personnalisé (capteur libre)” depending on language), the accordion **“Custom preset”** appears automatically.

### `rising` profile (higher value = worse)

```yaml
type: custom:jp2-air-quality
entity: sensor.formaldehyde
preset: custom
name: Formaldehyde
icon: mdi:flask
custom_preset:
  type: rising
  unit_fallback: "µg/m³"
  decimals: 0
  min: 0
  max: 250
  good_max: 50
  warn_max: 100
  label_good: OK
  label_warn: Warning
  label_bad: Alert
```

Rule:
- **good** if `value ≤ good_max`
- **warn** if `value ≤ warn_max`
- **bad** above that

### `band` profile (comfort zone in the middle)

```yaml
type: custom:jp2-air-quality
entity: sensor.humidity_cellar
preset: custom
name: Cellar humidity
custom_preset:
  type: band
  unit_fallback: "%"
  decimals: 0
  min: 0
  max: 100
  warn_low_min: 40
  good_min: 50
  good_max_band: 60
  warn_high_max: 70
  label_good: Comfort
  label_warn: Watch
  label_bad: Uncomfortable
```

Rule:
- **good** in `[good_min … good_max_band]`
- **warn** in `[warn_low_min … good_min[` and `]good_max_band … warn_high_max]`
- **bad** outside those zones

> Compatibility: in `band`, you can also use `good_max` and `warn_max` as aliases (the card remaps them).

---

## Full configuration

All keys below exist in the card (with their default values).

### Root key

| Key | Type | Default | Description |
|---|---:|---:|---|
| `card_mode` | string | `sensor` | `sensor` or `aqi` |

---

## `sensor` mode — options

### Source + preset
| Key | Type | Default | Description |
|---|---:|---:|---|
| `entity` | string | `""` | HA entity (e.g. `sensor.co2_livingroom`) |
| `preset` | string | `radon` | One of the presets (`radon`, `co2`, `voc`, `pm1`, `pm25`, `temperature`, `humidity`, `pressure`, `custom`) |
| `custom_preset` | object | `{}` | Present only when `preset: custom` |

### Header / display
| Key | Type | Default | Description |
|---|---:|---:|---|
| `name` | string | based on preset | Displayed title (falls back to `friendly_name`) |
| `icon` | string | based on preset | MDI icon |
| `show_top` | bool | `true` | Show header |
| `show_title` | bool | `true` | Show title |
| `show_secondary` | bool | `true` | Show secondary line (value/unit/status) |
| `show_secondary_value` | bool | `true` | Value in secondary line |
| `show_secondary_unit` | bool | `true` | Unit in secondary line |
| `show_secondary_state` | bool | `true` | Status (Good/Warn/Bad…) in secondary line |
| `show_icon` | bool | `true` | Show icon |
| `show_value` | bool | `true` | Show main value |
| `show_unit` | bool | `true` | Show main unit |

### Background, icon and knob
| Key | Type | Default | Description |
|---|---:|---:|---|
| `background_enabled` | bool | `false` | Status-colored background |
| `bar_enabled` | bool | `true` | Show threshold bar |
| `show_knob` | bool | `true` | Show knob on the bar |
| `knob_size` | number | `12` | Knob size (px) |
| `knob_outline` | bool | `true` | Knob outline |
| `knob_outline_size` | number | `2` | Outline size (px) |
| `knob_shadow` | bool | `true` | Knob shadow |
| `knob_color_mode` | string | `theme` | `theme` (theme color) or `status` (status color) |
| `icon_size` | number | `40` | Icon container size (px) |
| `icon_inner_size` | number | `22` | Inner MDI icon size (px) |
| `icon_background` | bool | `true` | Background blob behind the icon |
| `icon_circle` | bool | `true` | Circle (outline) around the icon |

### Typography
| Key | Type | Default | Description |
|---|---:|---:|---|
| `title_size` | number | `16` | Title size (px) |
| `value_size` | number | `18` | Value size (px) |
| `unit_size` | number | `12` | Unit size (px) |
| `secondary_value_size` | number | `12` | Secondary value size |
| `secondary_unit_size` | number | `12` | Secondary unit size |
| `secondary_state_size` | number | `12` | Secondary status size |

### Built-in graph (mini history)
| Key | Type | Default | Description |
|---|---:|---:|---|
| `show_graph` | bool | `true` | Show the mini graph |
| `graph_position` | string | `below_top` | `below_top`, `inside_top`, `top`, `bottom` |
| `hours_to_show` | number | `24` | History window (1–168 h) |
| `graph_height` | number | `42` | Height (px) |
| `line_width` | number | `2` | Line thickness |
| `graph_color_mode` | string | `segments` | `single` (one color), `peaks` (colored peaks), `segments` (colored segments) |
| `graph_color` | string | `""` | “good” color (otherwise theme) |
| `graph_warn_color` | string | `""` | “warn” color (otherwise `bar.warn`) |
| `graph_bad_color` | string | `""` | “bad” color (otherwise `bar.bad`) |

### Visualizer (full screen)
Opens when clicking the mini graph (if enabled).

| Key | Type | Default | Description |
|---|---:|---:|---|
| `visualizer_enabled` | bool | `true` | Enable full screen visualizer |
| `visualizer_ranges` | string | `6,12,24,72,168` | Shortcuts (in hours). Accepted separators: comma, semicolon, spaces |
| `visualizer_show_stats` | bool | `true` | Show statistics (min/max/avg) |
| `visualizer_show_thresholds` | bool | `true` | Show thresholds |
| `visualizer_smooth_default` | bool | `false` | Smooth lines by default |

> Shortcuts: accepted values are **1 to 720** hours (max 12 unique values).

### Threshold bar
`bar` object:

| Key | Type | Default | Description |
|---|---:|---:|---|
| `bar.align` | string | `center` | `left`, `center`, `right` (also accepts French `gauche`/`droite`) |
| `bar.width` | number | `92` | Bar width (% of the card) |
| `bar.height` | number | `6` | Height (px) |
| `bar.opacity` | number | `100` | Segment opacity (0–100) |
| `bar.good` | string | `#45d58e` | Good segment color |
| `bar.warn` | string | `#ffb74d` | Warn segment color |
| `bar.bad` | string | `#ff6363` | Bad segment color |

---

## `aqi` mode — options

### Base
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_title` | string | `AQI` | Title |
| `aqi_title_icon` | string | `""` | Optional MDI icon in the title |
| `aqi_entities` | list | `[]` | Entity list (strings) |
| `aqi_overrides` | object | `{}` | Per-entity overrides: `{ "sensor.xxx": { name, icon } }` |

### General display
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_show_title` | bool | `true` | Show title |
| `aqi_show_global` | bool | `true` | Show global status |
| `aqi_show_sensors` | bool | `true` | Show sensor list/tiles |
| `aqi_air_only` | bool | `false` | If `true`, global ignores temperature/humidity/pressure |

### Layout
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_layout` | string | `vertical` | `vertical` (list) or `horizontal` (tiles) |
| `aqi_tiles_per_row` | number | `3` | Tiles per row (horizontal mode) |
| `aqi_tiles_icons_only` | bool | `false` | “Icons only” tiles (compact) |
| `aqi_tile_color_enabled` | bool | `false` | Tint tile based on status |
| `aqi_tile_transparent` | bool | `false` | Transparent tile background |
| `aqi_tile_outline_transparent` | bool | `false` | Transparent tile outline |
| `aqi_tile_radius` | number | `16` | Radius (px) |

### Rows/sensors content
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_show_sensor_icon` | bool | `true` | Icon |
| `aqi_show_sensor_name` | bool | `true` | Name |
| `aqi_show_sensor_entity` | bool | `false` | Show entity_id |
| `aqi_show_sensor_value` | bool | `true` | Value |
| `aqi_show_sensor_unit` | bool | `true` | Unit |
| `aqi_show_sensor_status` | bool | `true` | Status (dot + text) |

### AQI typography (0 = auto)
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_text_name_size` | number | `0` | Name size |
| `aqi_text_name_weight` | number | `0` | Name weight |
| `aqi_text_value_size` | number | `0` | Value size |
| `aqi_text_value_weight` | number | `0` | Value weight |
| `aqi_text_unit_size` | number | `0` | Unit size |
| `aqi_text_unit_weight` | number | `0` | Unit weight |
| `aqi_text_status_size` | number | `0` | Status size |
| `aqi_text_status_weight` | number | `0` | Status weight |

### Sensor icon styling (AQI)
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_icon_size` | number | `34` | Icon size (px) |
| `aqi_icon_inner_size` | number | `18` | Inner MDI size (px) |
| `aqi_icon_background` | bool | `true` | Background |
| `aqi_icon_circle` | bool | `true` | Outline |
| `aqi_icon_color_mode` | string | `colored` | `colored` (status color) or `transparent` (theme color) |

### Global status (dot + text)
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_global_status_enabled` | bool | `true` | Enable global line |
| `aqi_global_status_show_dot` | bool | `true` | Dot |
| `aqi_global_status_show_text` | bool | `true` | Text |
| `aqi_global_status_dot_size` | number | `10` | Dot size |
| `aqi_global_status_dot_outline` | number | `1` | Dot outline |
| `aqi_global_status_text_size` | number | `0` | Text size (0 = auto) |
| `aqi_global_status_text_weight` | number | `0` | Text weight (0 = auto) |

### Global SVG (“quality” icon above the global status)
| Key | Type | Default | Description |
|---|---:|---:|---|
| `aqi_global_svg_enabled` | bool | `false` | Enable global SVG |
| `aqi_global_svg_size` | number | `52` | Size |
| `aqi_global_svg_color_mode` | string | `status` | `status` or `custom` |
| `aqi_global_svg_color` | string | `""` | Color when `custom` |
| `aqi_global_svg_show_icon` | bool | `true` | Show SVG |
| `aqi_global_svg_background` | bool | `true` | Circle background |
| `aqi_global_svg_background_color_mode` | string | `status` | `status` or `custom` |
| `aqi_global_svg_background_color` | string | `""` | Background color when `custom` |
| `aqi_global_svg_background_opacity` | number | `12` | Background opacity (%) |
| `aqi_global_svg_circle` | bool | `true` | Circle outline |
| `aqi_global_svg_circle_width` | number | `1` | Outline thickness |
| `aqi_global_svg_circle_color_mode` | string | `status` | `status` or `custom` |
| `aqi_global_svg_circle_color` | string | `""` | Outline color when `custom` |

---

# Examples (lots of variants)

## 1) CO₂ card “simple and effective”
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
name: Living room – CO₂
```

## 2) Same card, with colored background + status-colored knob
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
background_enabled: true
knob_color_mode: status
```

## 3) Temperature card (comfort zone) + graph at the bottom
```yaml
type: custom:jp2-air-quality
entity: sensor.temperature_livingroom
preset: temperature
graph_position: bottom
hours_to_show: 48
```

## 4) Humidity card without secondary line (ultra minimal)
```yaml
type: custom:jp2-air-quality
entity: sensor.humidity_livingroom
preset: humidity
show_secondary: false
```

## 5) Bar aligned left + thinner + wider
```yaml
type: custom:jp2-air-quality
entity: sensor.radon
preset: radon
bar:
  align: left
  width: 100
  height: 4
  opacity: 85
```

## 6) Custom threshold colors (bar + “segments” graph)
```yaml
type: custom:jp2-air-quality
entity: sensor.pm25_livingroom
preset: pm25
graph_color_mode: segments
bar:
  good: "#2ecc71"
  warn: "#f1c40f"
  bad: "#e74c3c"
```

## 7) Monochrome graph (`single` mode)
```yaml
type: custom:jp2-air-quality
entity: sensor.tvoc_livingroom
preset: voc
graph_color_mode: single
graph_color: "var(--primary-color)"
```

## 8) Graph with colored “peaks” (`peaks` mode)
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
graph_color_mode: peaks
graph_warn_color: "#ff9800"
graph_bad_color: "#f44336"
```

## 9) Disable the visualizer (no full screen on click)
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
visualizer_enabled: false
```

## 10) Visualizer with custom shortcuts
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
visualizer_ranges: "3, 6, 12, 24, 36, 72, 168"
visualizer_show_stats: true
visualizer_show_thresholds: true
visualizer_smooth_default: true
```

## 11) Big typography (wall dashboard)
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
title_size: 18
value_size: 34
unit_size: 14
secondary_value_size: 14
secondary_unit_size: 14
secondary_state_size: 14
icon_size: 52
icon_inner_size: 28
graph_height: 60
```

## 12) “Value only” card (no icon, no title)
```yaml
type: custom:jp2-air-quality
entity: sensor.co2_livingroom
preset: co2
show_icon: false
show_title: false
show_secondary: false
bar_enabled: false
show_graph: false
value_size: 42
unit_size: 14
```

## 13) Custom preset `rising`: an “odor index” sensor
```yaml
type: custom:jp2-air-quality
entity: sensor.odor_index
preset: custom
name: Odors
custom_preset:
  type: rising
  unit_fallback: "%"
  decimals: 0
  min: 0
  max: 100
  good_max: 30
  warn_max: 60
  label_good: OK
  label_warn: Ventilate
  label_bad: Strong
```

## 14) Custom preset `band`: “target zone” (e.g., ideal greenhouse humidity)
```yaml
type: custom:jp2-air-quality
entity: sensor.humidity_greenhouse
preset: custom
name: Greenhouse – humidity
custom_preset:
  type: band
  unit_fallback: "%"
  decimals: 0
  min: 0
  max: 100
  warn_low_min: 45
  good_min: 55
  good_max_band: 70
  warn_high_max: 80
  label_good: Great
  label_warn: Limit
  label_bad: Out of range
```

---

# AQI examples (multi-sensor)

## 15) Vertical AQI (list) – global status + sensors
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_title: Indoor AQI
aqi_entities:
  - sensor.co2_livingroom
  - sensor.tvoc_livingroom
  - sensor.pm25_livingroom
  - sensor.temperature_livingroom
  - sensor.humidity_livingroom
```

## 16) “Air only” AQI (ignore temp/humidity/pressure for the global)
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_air_only: true
aqi_entities:
  - sensor.co2_livingroom
  - sensor.tvoc_livingroom
  - sensor.pm25_livingroom
  - sensor.temperature_livingroom
  - sensor.humidity_livingroom
  - sensor.pressure_livingroom
```

## 17) Horizontal AQI (tiles) 4 per row + colored tiles
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_layout: horizontal
aqi_tiles_per_row: 4
aqi_tile_color_enabled: true
aqi_entities:
  - sensor.co2_livingroom
  - sensor.tvoc_livingroom
  - sensor.pm25_livingroom
  - sensor.temperature_livingroom
  - sensor.humidity_livingroom
  - sensor.pressure_livingroom
```

## 18) AQI tiles “icons only” (super compact)
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_layout: horizontal
aqi_tiles_per_row: 6
aqi_tiles_icons_only: true
aqi_tile_transparent: true
aqi_tile_outline_transparent: true
aqi_entities:
  - sensor.co2_livingroom
  - sensor.tvoc_livingroom
  - sensor.pm25_livingroom
  - sensor.temperature_livingroom
  - sensor.humidity_livingroom
  - sensor.pressure_livingroom
```

## 19) Rename / change icons for some sensors (overrides)
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_entities:
  - sensor.co2_livingroom
  - sensor.pm25_livingroom
  - sensor.tvoc_livingroom
aqi_overrides:
  sensor.co2_livingroom:
    name: CO₂
    icon: mdi:molecule-co2
  sensor.pm25_livingroom:
    name: PM2.5
    icon: mdi:blur
  sensor.tvoc_livingroom:
    name: TVOC
    icon: mdi:chemical-weapon
```

## 20) Neutral AQI icons (theme-colored), no background
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_icon_color_mode: transparent
aqi_icon_background: false
aqi_icon_circle: false
aqi_entities:
  - sensor.co2_livingroom
  - sensor.pm25_livingroom
  - sensor.tvoc_livingroom
```

## 21) Custom AQI typography (everything is “auto” by default)
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_text_name_size: 13
aqi_text_name_weight: 600
aqi_text_value_size: 18
aqi_text_value_weight: 700
aqi_text_unit_size: 12
aqi_text_unit_weight: 500
aqi_text_status_size: 12
aqi_text_status_weight: 500
aqi_entities:
  - sensor.co2_livingroom
  - sensor.pm25_livingroom
  - sensor.tvoc_livingroom
```

## 22) Global SVG + custom colors
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_global_svg_enabled: true
aqi_global_svg_color_mode: custom
aqi_global_svg_color: "#00bcd4"
aqi_global_svg_background_color_mode: custom
aqi_global_svg_background_color: "#00bcd4"
aqi_global_svg_background_opacity: 10
aqi_global_svg_circle_color_mode: custom
aqi_global_svg_circle_color: "#00bcd4"
aqi_entities:
  - sensor.co2_livingroom
  - sensor.pm25_livingroom
  - sensor.tvoc_livingroom
```

## 23) Minimal global (dot only, no text)
```yaml
type: custom:jp2-air-quality
card_mode: aqi
aqi_global_status_show_text: false
aqi_entities:
  - sensor.co2_livingroom
  - sensor.pm25_livingroom
  - sensor.tvoc_livingroom
```

---

## Combine with other cards (stacks / grid)

### 24) “Dashboard row” with 3 sensor cards
```yaml
type: grid
columns: 3
square: false
cards:
  - type: custom:jp2-air-quality
    entity: sensor.co2_livingroom
    preset: co2
  - type: custom:jp2-air-quality
    entity: sensor.pm25_livingroom
    preset: pm25
  - type: custom:jp2-air-quality
    entity: sensor.tvoc_livingroom
    preset: voc
```

### 25) In a column, with a global AQI on top
```yaml
type: vertical-stack
cards:
  - type: custom:jp2-air-quality
    card_mode: aqi
    aqi_air_only: true
    aqi_layout: horizontal
    aqi_tiles_per_row: 5
    aqi_tile_color_enabled: true
    aqi_entities:
      - sensor.co2_livingroom
      - sensor.tvoc_livingroom
      - sensor.pm25_livingroom
      - sensor.temperature_livingroom
      - sensor.humidity_livingroom
  - type: custom:jp2-air-quality
    entity: sensor.radon
    preset: radon
    background_enabled: true
```

---

# Interactions

- **Click on the header (`sensor` mode)**: opens Home Assistant “More info” for the entity (`hass-more-info`).
- **Click on the mini graph (`sensor` mode)**: opens the full screen **visualizer** (if `visualizer_enabled: true` and `show_graph: true`).
  - Press **ESC** to close.
- **Click on a row/tile (`aqi` mode)**: opens “More info” for the corresponding sensor.

---

# Troubleshooting / FAQ

### “Entity not found”
- Check `entity:` (spelling, correct domain like `sensor.`…)
- Verify the entity exists in **Developer Tools → States**.

### “History unavailable”
The graph uses Home Assistant `history/period` API:
- If the entity has no history (Recorder disabled, entity excluded, database purged), the graph cannot show.
- If the state is not numeric (e.g., `unknown`, `unavailable`, text…), the card cannot plot it.

### The status does not match your thresholds
- Check `preset:` (or use `preset: custom`).
- Check the unit (e.g., ppm / ppb / µg/m³).
- With `custom_preset`, ensure `min < max` and thresholds are ordered (the card sanitizes invalid configs).

### I want a more compact look
- Reduce `icon_size`, `value_size`, `graph_height`, and/or disable:
  - `show_secondary`, `show_graph`, `bar_enabled`.

---

# Technical notes (useful for dev)

- The card caches history for 60s per entity/window (`entityId|hours`) to avoid spamming the API.
- `hours_to_show` is clamped to **1–168** hours (mini graph).
- `visualizer_ranges` accepts up to **12** unique values, from **1 to 720** hours.
- “good/warn/bad” colors come from `bar.good/warn/bad` (with fallbacks).

---

## Changelog (excerpt)

- **v2.0.10**: added **custom preset** (free sensor) + “Custom preset” accordion in the editor.
- **v2.0.9**: editor UI fixes (accordions, focus).
- **v2.0.8**: editor accordions per block.
