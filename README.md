<div align="center">
<img src="docs/images/preview.png" alt="JP2 Air Quality Card preview" width="100%"><br>


[![HACS Custom][hacs_shield]][hacs]
![Latest Stable Version](https://img.shields.io/packagist/v/jp2creation/jp2-air-quality?label=version)
[![GitHub All Releases][downloads_total_shield]][releases]
[![Buy me a coffee][buy_me_a_coffee_shield]][buy_me_a_coffee]


</div>

---

## 🚀 What is it?

**JP2 Air Quality Card** is a Lovelace card with a clean **dashboard look** designed to display **air quality** and **comfort** at a glance:  
CO₂, VOC/COV, radon, pressure, temperature, humidity…  
It includes a **colored gauge**, a **status label**, an optional **IQA summary** and an integrated **history graph**.

> ✅ **V2.0.0**: full visual editor redesign (smoother UI), improved stability, cleaner internal structure — especially when enabling **IQA** and/or **Graph**.

---

## ✨ Highlights

- Dashboard design (great on dark themes / Mushroom-like styles)
- Multi-sensors display (CO₂, VOC, radon, pressure, temperature, humidity…)
- Color gauge (green/yellow/red) + cursor indicator
- Status text (*Good*, *Ventilate*, *Comfort*, *Variable*…)
- **IQA mode**: global Air Quality summary + per-entity rows
- Option to **hide sensor list** in IQA mode
- Built-in history graph (no need for `mini-graph-card`)
- UI options:
  - icon resize
  - hide icon background
  - hide icon ring/circle
- When **IQA + Graph** are enabled: optional automatic removal of the divider bar for a cleaner layout

---

## 🧩 Quick links

- 📦 Latest release: [Releases][releases]
- 🛠️ HACS custom repositories doc: [HACS Custom Repo][hacs]
- ☕ Support: [Buy me a coffee][buy_me_a_coffee]

---

## ✅ Requirements

- Home Assistant with Lovelace dashboards
- Access to `/config/www/` for manual install (optional)
- Sensors with **numeric states** (required for graph)

---

## 📦 Installation

### Option A — HACS (Custom repository)

1. HACS → **Frontend**
2. Menu (⋮) → **Custom repositories**
3. Add:
   - Repository: `jp2creation/jp2-air-quality`
   - Category: `Lovelace`
4. Install the card
5. Refresh browser cache

If the resource isn’t added automatically:
- Settings → Dashboards → Resources → Add
- URL: `/hacsfiles/jp2-air-quality/jp2-air-quality.js`
- Type: `Module`

### Option B — Manual

1. Copy **`jp2-air-quality.js`** to:
   - `/config/www/`  (Lovelace path is `/local/`)
2. Add Lovelace resource:
   - Settings → Dashboards → Resources → Add
   - URL: `/local/jp2-air-quality.js`
   - Type: `Module`
3. Hard refresh the browser

> ⚠️ Important: the main file must stay named exactly **`jp2-air-quality.js`**.

---

## ⚡ Quick start

```yaml
type: custom:jp2-air-quality
title: Air quality
entities:
  radon: sensor.radon_bq_m3
  co2: sensor.co2_ppm
  voc: sensor.voc_ppb
  pressure: sensor.pressure_hpa
  temperature: sensor.temperature_salon
  humidity: sensor.humidity_salon
```

---

## ⚙️ Configuration

### Advanced example (IQA + Graph + UI options)

```yaml
type: custom:jp2-air-quality
title: Salon

# Graph
show_graph: true
graph_hours: 24

# Icon style
icon:
  size: 44
  show_background: false
  show_circle: false

# IQA (Air Quality Index summary)
iqa:
  enabled: true
  hide_sensors: true
  sensors:
    - entity: sensor.co2_ppm
      label: CO2
      unit: ppm
      good: 800
      medium: 1200
    - entity: sensor.voc_ppb
      label: VOC
      unit: ppb
      good: 150
      medium: 300
```

---

## 📚 Options reference

If an option is not available in your version, it is simply ignored.

### General

| Option      | Type   | Default | Description |
|------------|--------|---------|-------------|
| `title`    | string | —       | Card title |
| `entities` | object | —       | Sensors mapping (`co2`, `voc`, `radon`, `pressure`, `temperature`, `humidity`…) |

### Graph

| Option         | Type    | Default | Description |
|---------------|---------|---------|-------------|
| `show_graph`  | boolean | false   | Enables built-in history graph |
| `graph_hours` | number  | 24      | History window (hours) |

### Icon

| Option                 | Type    | Default | Description |
|------------------------|---------|---------|-------------|
| `icon.size`            | number  | 44      | Icon size (px) |
| `icon.show_background` | boolean | true    | Show/hide icon background |
| `icon.show_circle`     | boolean | true    | Show/hide icon ring |

### IQA

| Option              | Type    | Default | Description |
|--------------------|---------|---------|-------------|
| `iqa.enabled`      | boolean | false   | Enables IQA summary mode |
| `iqa.hide_sensors` | boolean | false   | Hides the sensor list in IQA mode |
| `iqa.sensors`      | array   | `[]`    | IQA sensors list with thresholds |

#### `iqa.sensors[]` item

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `entity` | string | ✅       | HA entity (ex: `sensor.co2_ppm`) |
| `label`  | string | ✅       | Display name |
| `unit`   | string | ❌       | Display unit (ppm/ppb/…) |
| `good`   | number | ✅       | “Good” threshold |
| `medium` | number | ✅       | “Medium” threshold (above = “Bad”) |

---

## 🧠 Visual editor (V2.0.0)
<img src="docs/images/editor.png" alt="JP2 Air Quality Card preview" width="100%"><br>
V2.0.0 includes a full redesign of the visual editor:
- smoother UI / fewer freezes
- clearer settings sections
- more stable behavior when enabling IQA and/or Graph
- cleaner internal code structure for easier maintenance

---

## ✅ Best practices

- CO₂ high → ventilate/open windows
- VOC → check sources (paints, solvents, sprays), ventilate
- Radon → evaluate over time (average), take action if persistent

---

## 🧯 Troubleshooting

### Card not showing / “Custom element doesn’t exist”
- Check the resource path (`/local/...` or `/hacsfiles/...`)
- Ensure the resource type is **Module**
- Hard refresh the browser

### Old version still loaded
- Clear browser cache  
- Or use a cache buster:  
  `/local/jp2-air-quality.js?v=2`

### Graph is empty
- The entity must have history (Recorder enabled)
- The entity state must be numeric

### Freeze when enabling IQA
- Update to **2.0.0+** (visual editor + stability improvements)

---

## ❓ FAQ

<details>
  <summary><b>Can I use the card with only CO₂ and temperature?</b></summary>

Yes. You can provide only the sensors you have; the card adapts.
</details>

<details>
  <summary><b>Can I create one card per room?</b></summary>

Yes. Duplicate the YAML and change the title + entities.
</details>

<details>
  <summary><b>Does the built-in graph replace mini-graph-card?</b></summary>

Yes. This card includes its own graph based on Home Assistant history.
</details>

---

## 🛠️ Development

Copy `jp2-air-quality.js` into `/config/www/`  
Add resource: `/local/jp2-air-quality.js?v=dev`  
Hard refresh browser after each change

Tip: keeping `?v=dev` helps bypass cache when iterating quickly.

---

## 🤝 Contributing

Please open an Issue with:
- Home Assistant version
- YAML config (remove sensitive info)
- Console logs (F12) if any

PR workflow:
1. Fork
2. Create a branch: `feature/my-feature`
3. Clean commits
4. Pull Request

---

## 🧾 Changelog

See the GitHub releases page: [Releases][releases]

---

## 📄 License

MIT — see `LICENSE`.

---

## ☕ Support

If this project helps you, you can support it here: [Buy me a coffee][buy_me_a_coffee]

---

<!-- Badges / links -->

[hacs_shield]: https://img.shields.io/badge/HACS-Custom-blue.svg
[downloads_total_shield]: https://img.shields.io/github/downloads/jp2creation/jp2-air-quality/total
[buy_me_a_coffee_shield]: https://img.shields.io/badge/Buy%20me%20a%20coffee-Support-orange.svg

[hacs]: https://hacs.xyz/docs/faq/custom_repositories/
[releases]: https://github.com/jp2creation/jp2-air-quality/releases
[buy_me_a_coffee]: https://www.buymeacoffee.com/jp2creation
