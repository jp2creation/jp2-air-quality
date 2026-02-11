# JP2 Air Quality

Custom Lovelace card that renders a **Mushroom Template Card** + **mini-graph-card** inside one card,
with a **threshold bar + cursor** and a **full Visual Editor** (UI editor).

## Features
- Presets:
  - `radon` (ascendant vert/orange/rouge)
  - `voc` (COV/TVOC) (ascendant)
  - `pm1` (ascendant)
  - `pm25` (ascendant)
  - `pressure` (rouge/orange/vert/orange/rouge)
  - `humidity` (rouge/orange/vert/orange/rouge)
  - `temperature` (rouge/orange/vert/orange/rouge)
- Optional graph (mini-graph-card)
- Threshold bar/cursor via `card-mod`
- Visual editor via `getConfigForm()`
- Advanced overrides:
  - `secondary` (template)
  - `color` (template)
  - `mushroom` (YAML object merged into mushroom card)
  - `graph` (YAML object merged into mini-graph-card)
  - `name_by_preset`, `icon_by_preset` (global mapping overrides)

## Requirements (HACS)
Install:
- Mushroom
- mini-graph-card
- card-mod

## Install (HACS)
1. HACS → Frontend → Custom repositories → add this repository as **Plugin**
2. Install
3. Add resource if not auto-added:
   - URL: `/hacsfiles/jp2-air-quality/jp2-air-quality.js`
   - Type: `module`
4. Clear cache / CTRL+F5

## Usage

### Radon
```yaml
type: custom:jp2-air-quality
preset: radon
entity: sensor.wave_plus_couloir_radon
name: Radon
