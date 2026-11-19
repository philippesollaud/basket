---
title: Spécification fonctionnelle | Le banc
description: Besoins, règles métier et critères d’acceptation de l’application Basket U11.
ms.date: 2026-11-18
ms.topic: reference
keywords:
  - basket U11
  - spécification fonctionnelle
  - PWA
---

## Objectif et périmètre

L’application fournit un carnet de match en français, optimisé pour un
téléphone Android. Elle permet de préparer une rencontre de l’ALM, d’enregistrer
les actions au bord du terrain, puis de consulter ou sauvegarder le carnet.

L’application est personnelle et locale. Elle ne comporte ni compte utilisateur,
ni backend, ni synchronisation automatique entre appareils. Les règles ci-dessous
sont celles définies pour cet usage U11 ; elles ne sont pas vérifiées contre un
règlement officiel.

## Parcours et écrans

### Terrain

Quand aucun match n’est actif, l’écran permet de :

* saisir le nom de l’équipe adverse, qui est obligatoire
* indiquer si l’ALM joue à domicile ou à l’extérieur
* sélectionner exactement 10 joueurs parmi l’effectif permanent de 14
* attribuer à chacun un numéro de 1 à 3 chiffres, unique dans le match
* démarrer le match

Une fois un match démarré, cet écran devient le tableau de suivi. Il affiche le
score de la période, les points de match cumulés des périodes terminées, les
actions de score, l’annulation de la dernière action et la clôture de la période
ou du match.

### Effectif ALM

L’effectif contient toujours 14 joueurs. Leurs noms sont modifiables ; aucun
numéro de maillot permanent n’est associé à un joueur. Une modification de
l’effectif ne change pas les noms et numéros déjà enregistrés dans un match.

### Historique

Les rencontres terminées sont présentées de la plus récente à la plus ancienne.
Chaque entrée donne accès aux résultats par période et aux statistiques des
joueurs présents dans la feuille de match.

### Sauvegardes

L’écran permet d’exporter les données, d’importer une sauvegarde après
validation et confirmation explicite, et de demander au navigateur de protéger
le stockage local contre l’effacement automatique.

## Règles d’un match

* Un seul match peut être actif à la fois.
* Un match comporte huit périodes.
* Chaque période commence avec un score de paniers de 0 à 0.
* Les actions de score disponibles ajoutent 1 ou 2 points.
* À la fin d’une période, son vainqueur reçoit 3 points de match, le perdant 1,
  ou chaque équipe reçoit 2 points en cas d’égalité.
* Le résultat final est déterminé par la somme des points de match des huit
  périodes, et non par le cumul des paniers.
* Une égalité finale est permise. Aucune prolongation n’est prévue.
* La clôture d’une période ou du match demande confirmation et est irréversible.
* L’annulation retire uniquement la dernière action de la période en cours.
  Elle ne peut pas modifier une période clôturée.
* Aucun chronomètre de match ou de possession n’est demandé.

## Enregistrement des actions et statistiques

Pour l’ALM, le choix de `+1`, `+2` ou d’une faute ouvre une liste des joueurs
sélectionnés. L’action n’est enregistrée qu’après le choix d’un joueur.
Annuler la sélection ne modifie pas le match.

Pour l’adversaire, les boutons `+1` et `+2` enregistrent immédiatement le score,
sans demander ni conserver de joueur adverse.

Le suivi des fautes est facultatif et désactivé par défaut. Quand il est activé,
les fautes ne peuvent être attribuées qu’aux joueurs ALM. Elles sont cumulées
sur le match, n’affectent pas le score et ne provoquent aucune exclusion
automatique. Désactiver le suivi masque les fautes dans l’interface sans effacer
les actions déjà enregistrées.

Pour les nouveaux matchs ALM, les statistiques affichent les points de chaque
joueur ALM et, si le suivi est activé, leurs fautes. Aucun détail individuel
n’est collecté pour l’adversaire. Les feuilles des anciens matchs conservent
les joueurs déjà enregistrés.

## Données, continuité et confidentialité

Le carnet, le match actif, l’historique, l’effectif et le réglage des fautes sont
conservés sur l’appareil. Les données ne sont pas partagées entre le serveur de
prévisualisation, le site public ou un autre appareil. Le transfert s’effectue
par export puis import manuel.

L’export JSON comprend l’effectif ALM, les réglages, les matchs terminés et
actifs ainsi que les sélections et actions correspondantes. L’import remplace
toutes les données du carnet après confirmation. Les sauvegardes v1 restent
importables ; les exports actuels sont en v2. Un fichier invalide ou trop
volumineux ne doit modifier aucune donnée.

Effacer les données du navigateur, désinstaller l’application ou perdre
l’appareil peut supprimer le carnet. L’export régulier est donc nécessaire,
même si le navigateur accorde la protection du stockage persistant.

## Critères d’acceptation

* Le parcours de préparation refuse un nom adverse vide, une sélection autre
  que 10 joueurs et des numéros invalides ou dupliqués, y compris `04` et `4`.
* Le score adverse ne demande jamais de joueur et les paniers ALM ne sont
  persistés qu’après sélection d’un joueur.
* Les paniers repartent à zéro à chaque période ; les points de match et les
  fautes cumulées restent cohérents avec les actions enregistrées.
* Les confirmations empêchent une clôture accidentelle ; une période clôturée
  ne peut pas être annulée.
* Le match actif est retrouvé après rechargement et après fermeture/réouverture
  du navigateur.
* L’historique conserve les résultats des huit périodes et autorise un résultat
  final nul.
* Une sauvegarde valide restaure les données après confirmation ; une
  sauvegarde invalide est rejetée sans écriture.
* Après la mise en cache initiale, l’application et le carnet restent
  utilisables hors ligne.
* Une mise à jour disponible ne recharge pas l’application pendant un match
  actif.

Les tests automatisés associés se trouvent dans
[`src/domain.test.ts`](../src/domain.test.ts),
[`src/alm.test.ts`](../src/alm.test.ts),
[`src/storage.test.ts`](../src/storage.test.ts),
[`src/App.test.tsx`](../src/App.test.tsx) et
[`e2e/app.spec.ts`](../e2e/app.spec.ts).
