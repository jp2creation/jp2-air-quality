# JP2 Air Quality

Carte Lovelace custom qui affiche une **Mushroom Template Card** + **mini-graph-card**,
avec une **barre horizontale colorée (seuils) au-dessus du graphe**.

## Presets
- `radon`, `voc`, `pm1`, `pm25` (seuils ascendants vert/orange/rouge)
- `pressure`, `humidity`, `temperature` (bandes rouge/orange/vert/orange/rouge)

> Les seuils restent configurables en YAML, mais **ne sont plus exposés dans l’éditeur visuel**.

## Pré-requis
- Mushroom
- mini-graph-card
- card-mod

## Installation (HACS)
- Ressource : `/hacsfiles/jp2-air-quality/jp2-air-quality.js` (module)

## Options

### Fond de carte coloré (optionnel)

```yaml
background_enabled: true
```

### Barre (largeur/hauteur/couleurs)


```yaml
bar:
  align: center  # left|center|right
  width: 92     # % (10–100)
  height: 6     # px (2–20)
  good: "#45d58e"
  warn: "#ffb74d"
  bad:  "#ff6363"
```

Masquer la barre :
```yaml
bar_enabled: false
```

(ou en YAML avancé :)

```yaml
bar:
  enabled: false
```

## Exemple
```yaml
type: custom:jp2-air-quality
preset: pm25
entity: sensor.air_pm2_5
name: PM2.5
bar:
  align: center  # left|center|right
  width: 90
  height: 8
  good: "#2ecc71"
  warn: "#f1c40f"
  bad:  "#e74c3c"
```

## License
MIT
