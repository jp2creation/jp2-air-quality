# JP2 Air Quality Card (Home Assistant)
[![HACS Custom][hacs_shield]][hacs]
[![GitHub Latest Release][releases_shield]][latest_release]
[![GitHub All Releases][downloads_total_shield]][releases]
[![Buy me a coffee][buy_me_a_coffee_shield]][buy_me_a_coffee]


[hacs_shield]: https://img.shields.io/static/v1.svg?label=HACS&message=Custom&style=popout&color=orange&labelColor=41bdf5&logo=HomeAssistantCommunityStore&logoColor=white
[hacs]: https://hacs.xyz/docs/faq/custom_repositories

[latest_release]: https://github.com/jp2creation/jp2-air-quality/releases/latest
[releases_shield]:https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjp2creation%2Fjp2-air-quality%2Fmaster%2Fcustom_components%2Fsamsung_soundbar%2Fmanifest.json&query=%24.version&label=release



[releases]: https://github.com/jp2creation/p2-air-quality/releases/latest
[downloads_total_shield]: https://img.shields.io/github/downloads/jp2creation/jp2-air-quality/total


[buy_me_a_coffee_shield]: https://img.shields.io/static/v1.svg?label=%20&message=Buy%20me%20a%20coffee&color=6f4e37&logo=buy%20me%20a%20coffee&logoColor=white
[buy_me_a_coffee]: https://www.buymeacoffee.com/jp2creation

Une carte Lovelace au style “dashboard” pour afficher **qualité de l’air** et **confort** (CO₂, COV/VOC, radon, pression, température, humidité…), avec une **jauge colorée** et un **indicateur**.

![Aperçu de la carte](docs/images/preview.jpg)

---

## Points clés

- **Design dashboard** (parfait sur thèmes sombres / style Mushroom).
- Affichage **multi-capteurs** (CO₂, COV/VOC, radon, pression, température, humidité…).
- **Jauge** avec zones (vert/jaune/rouge) + **curseur** de position.
- **Texte de statut** (ex. *Bon*, *À aérer*, *Confort*, *Variable*…).
- **IQA (Indice Qualité d’Air)** : vue “résumé” avec entités (CO₂, COV/VOC, etc.) et statut global (*Bon / Moyen / Mauvais*).
- Option IQA : **masquer la liste des capteurs**.
- **Graphe interne** basé sur l’historique Home Assistant (remplace `mini-graph-card`).
- Options d’UI :
  - **redimensionner l’icône**
  - **masquer le fond de l’icône**
  - **masquer le cercle/anneau** autour de l’icône
- Quand **IQA + Graphe** sont activés : la **barre de séparation** peut être automatiquement retirée (interface plus clean).

> ℹ️ Les noms exacts des options peuvent légèrement varier selon ta version.  
> Le plus fiable : ouvrir l’éditeur visuel de la carte (si présent) pour voir la liste complète.

---

## Prérequis

- **Home Assistant** avec un dashboard **Lovelace**.
- Accès au dossier `/config/www/` (pour installation manuelle).
- Des entités capteurs (`sensor.*`) dans Home Assistant.

---

## Installation (manuelle)

1. Copier le fichier **`jp2-air-quality.js`** dans :
   - `/config/www/`  (ce qui correspond à `/local/` dans Lovelace)

2. Ajouter la ressource Lovelace :

   **Paramètres → Tableaux de bord → Ressources → Ajouter**
   - **URL :** `/local/jp2-air-quality.js`
   - **Type :** *Module*

3. Recharger le navigateur (ou vider le cache si besoin).

---

## Configuration

### Exemple minimal (YAML)

```yaml
type: custom:jp2-air-quality
title: Qualité de l’air
entities:
  radon: sensor.radon_bq_m3
  co2: sensor.co2_ppm
  voc: sensor.voc_ppb
  pressure: sensor.pressure_hpa
  temperature: sensor.temperature_salon
  humidity: sensor.humidity_salon
```

### Exemple avancé (IQA + graphe + options visuelles)

```yaml
type: custom:jp2-air-quality
title: Salon

# Affichage
show_graph: true
graph_hours: 24

# Style icône
icon:
  size: 44
  show_background: false
  show_circle: false

# IQA (indice qualité d’air)
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
      label: COV
      unit: ppb
      good: 150
      medium: 300
```

> Astuce : pour un bon rendu, utilise des unités cohérentes (ppm, ppb, Bq/m³, hPa, °C, %).

---

## Conseils d’utilisation

- **CO₂ élevé** : ventiler / ouvrir une fenêtre.
- **COV/VOC** : identifier sources (peintures, solvants, parfums d’ambiance), aérer.
- **Radon** : surveiller sur la durée (moyenne), agir si niveaux persistants.

---

## Dépannage

- **La carte n’apparaît pas / “Custom element doesn’t exist”**  
  → vérifier la ressource (`/local/jp2-air-quality.js`) et qu’elle est en **Module**.

- **Ancienne version affichée**  
  → vider cache navigateur, ou changer l’URL en ajoutant un cache-buster :  
  `/local/jp2-air-quality.js?v=1`

- **Le graphe ne s’affiche pas**  
  → vérifier que l’entité a bien un historique (Recorder) et un état numérique.

---

## Changelog (résumé)

- Ajout : redimensionnement icône + masquage fond/cercle
- Ajout : IQA + option “masquer la liste des capteurs”
- Amélioration : retrait barre de séparation quand IQA + Graphe
- Remplacement : `mini-graph-card` → graphe interne basé HA History

---

## Licence

À définir (MIT recommandé).
