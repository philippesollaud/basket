---
title: Le banc | Basket U11
description: Feuille de match de basketball U11, utilisable hors ligne sur téléphone.
ms.date: 2026-11-18
---

![Icône de l’application Le banc](./public/icon.svg)

## Le banc | Basket U11

Une application web progressive en français pour préparer et suivre les matchs
U11 de l’ALM sur téléphone. Les données restent dans le navigateur : aucun
compte, backend ou service de synchronisation n’est utilisé. Après son premier
chargement et la mise en cache, l’application fonctionne hors ligne.

> [!IMPORTANT]
> Les données sont propres au navigateur, à l’appareil et à l’origine du site.
> Exportez régulièrement une sauvegarde JSON. Effacer les données du site peut
> supprimer le carnet.

## Fonctions

* Préparer un match en sélectionnant 10 joueurs parmi les 14 de l’effectif ALM
* Attribuer des numéros propres à chaque match et choisir domicile ou extérieur
* Enregistrer les paniers par joueur pour ALM et directement pour l’adversaire
* Suivre facultativement les fautes des joueurs ALM
* Consulter les périodes, les résultats et les statistiques dans l’historique
* Exporter ou restaurer le carnet au format JSON
* Installer la PWA et suivre un match sans réseau après la mise en cache initiale

Les règles de score sont des règles définies pour cet usage U11 et ne sont pas
présentées comme un règlement officiel.

## Prérequis

* Node.js `>=22.12.0`
* npm

## Développement local

```powershell
npm ci
npm run dev
```

Vite affiche l’adresse locale à ouvrir dans le navigateur.

## Vérification

```powershell
npm run lint
npm run test
npm run build
```

Pour les tests de bout en bout, installez Chromium pour Playwright si nécessaire,
puis lancez la suite desktop et mobile :

```powershell
npx playwright install chromium
npm run test:e2e
```

La suite utilise un serveur de prévisualisation local sur le port `4174`.

## Publication Azure

Le script PowerShell construit l’application puis déploie le dossier `dist` vers
Azure Static Web Apps. Azure CLI doit être installé et connecté, et le compte
doit pouvoir récupérer le jeton de déploiement de l’application.

```powershell
.\scripts\deploy.ps1 -SubscriptionId "<subscription-id>"
```

Les paramètres `ResourceGroup` et `AppName` sont facultatifs. Leurs valeurs par
défaut et la procédure complète figurent dans
[Architecture et exploitation](./docs/architecture-exploitation.md).

Ne placez aucun jeton ni identifiant secret dans le dépôt. Le script utilise le
jeton de déploiement de façon transitoire.

## Documentation

* [Spécification fonctionnelle](./docs/specification-fonctionnelle.md)
* [Architecture et exploitation](./docs/architecture-exploitation.md)
