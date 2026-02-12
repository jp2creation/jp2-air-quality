# JP2 Air Quality Card (Home Assistant)
[![HACS Custom][hacs_shield]][hacs]
![Latest Stable Version](https://img.shields.io/packagist/v/jp2creation/jp2-air-quality?label=version)
[![GitHub All Releases][downloads_total_shield]][releases]
[![Buy me a coffee][buy_me_a_coffee_shield]][buy_me_a_coffee]

[hacs_shield]: https://img.shields.io/static/v1.svg?label=HACS&message=Custom&style=popout&color=orange&labelColor=41bdf5&logo=HomeAssistantCommunityStore&logoColor=white
[hacs]: https://hacs.xyz/docs/faq/custom_repositories

[releases]: https://github.com/jp2creation/jp2-air-quality/releases/latest
[downloads_total_shield]: https://img.shields.io/github/downloads/jp2creation/jp2-air-quality/total

[buy_me_a_coffee_shield]: https://img.shields.io/static/v1.svg?label=%20&message=Buy%20me%20a%20coffee&color=6f4e37&logo=buy%20me%20a%20coffee&logoColor=white
[buy_me_a_coffee]: https://www.buymeacoffee.com/jp2creation

Une carte Lovelace au style “dashboard” pour afficher **qualité de l’air** et **confort** (CO₂, COV/VOC, radon, pression, température, humidité…), avec une **jauge colorée** et un **indicateur**.

> ✅ **Version 2.0.0 (V2)** : refonte totale côté **éditeur visuel** (UI plus fluide), code restructuré et stabilité renforcée (notamment lors de l’activation IQA / Graph).

![Aperçu de la carte](docs/images/preview.jpg)

---

## Table des matières

- [Points clés](#points-clés)
- [Compatibilité](#compatibilité)
- [Installation](#installation)
  - [HACS (Custom repository)](#option-a--hacs-custom-repository)
  - [Installation manuelle](#option-b--installation-manuelle)
  - [Mise à jour](#mise-à-jour)
- [Configuration](#configuration)
  - [Exemple minimal](#exemple-minimal-yaml)
  - [Exemple avancé](#exemple-avancé-iqa--graphe--options-visuelles)
  - [Référence des options](#référence-des-options)
- [Éditeur visuel V2.0.0](#éditeur-visuel-v200)
- [Conseils d’utilisation](#conseils-dutilisation)
- [Dépannage](#dépannage)
- [FAQ](#faq)
- [Développement](#développement)
- [Contribuer](#contribuer)
- [Changelog](#changelog)
- [Licence](#licence)

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

> ℹ️ Certaines options peuvent varier selon ta version.  
> Le plus fiable : ouvrir l’éditeur visuel de la carte pour voir la liste complète.

---

## Compatibilité

- Requis : un dashboard **Lovelace** sur **Home Assistant**.
- Capteurs recommandés : `sensor.*` avec états **numériques** (particulièrement pour le graphe).
- Historique : si tu veux le graphe, assure-toi que l’entité est bien enregistrée par **Recorder** (ou une solution d’historique équivalente).

---

## Installation

### Option A — HACS (Custom repository)

1. Ouvre **HACS** → **Frontend**
2. Menu (⋮) → **Custom repositories**
3. Ajoute :
   - **Repository :** `jp2creation/jp2-air-quality`
   - **Category :** `Lovelace`
4. Installe la carte
5. Recharge le navigateur (ou vide le cache)

**Ressource Lovelace (si nécessaire)**
- Paramètres → Tableaux de bord → Ressources → Ajouter
- URL : `/hacsfiles/jp2-air-quality/jp2-air-quality.js`
- Type : `Module`

### Option B — Installation manuelle

1. Copier le fichier **`jp2-air-quality.js`** dans :
   - `/config/www/` (ce qui correspond à `/local/` dans Lovelace)

2. Ajouter la ressource Lovelace :
   - Paramètres → Tableaux de bord → Ressources → Ajouter
   - **URL :** `/local/jp2-air-quality.js`
   - **Type :** `Module`

3. Recharger le navigateur (ou vider le cache).

> ⚠️ Important : le fichier principal doit rester nommé exactement **`jp2-air-quality.js`**.

---

## Mise à jour

### Via HACS
- HACS → Frontend → `JP2 Air Quality Card` → Update

### Manuelle
- Remplacer `jp2-air-quality.js` dans `/config/www/`
- Vider le cache du navigateur (ou redémarrer l’app HA sur mobile)

**Astuce cache-buster**
- `/local/jp2-air-quality.js?v=2`

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

