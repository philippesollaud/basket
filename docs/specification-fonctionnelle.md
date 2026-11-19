---
title: Spécification fonctionnelle | Le banc v3
description: Besoins, règles métier et critères d’acceptation de l’application Basket U11.
ms.date: 2026-11-19
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
* sélectionner de 6 à 10 joueurs parmi l’effectif permanent de 14
* proposer le numéro préféré de chaque joueur sélectionné ou, à défaut, un
  numéro automatique suivant l’ordre de sélection : 4 pour le premier
  joueur, 5 pour le deuxième, etc., en sautant les numéros déjà attribués
* modifier les numéros proposés et résoudre les doublons avant de démarrer
* démarrer le match

Une fois un match démarré, cet écran devient le tableau de suivi. Il affiche le
score de la période et les points de match cumulés. Les huit périodes sont
représentées par des pastilles rondes numérotées et colorées selon leur résultat :
gagnée, nulle, perdue ou à jouer. La période en cours est mise en évidence sans
libellé supplémentaire ni légende. À l’extérieur, l’ALM apparaît à droite du
score et des commandes d’action. Le score, les commandes de points, l’annulation
et la clôture tiennent dans la zone visible d’un écran de téléphone.

Après la clôture de la 8e période, le tableau reste à l’écran avec le score de
la dernière période, les points de match et les statistiques. La saisie
d’actions n’est plus possible. Le match reste actif, même après rechargement,
jusqu’à la confirmation du bouton « Clôturer le match ». Il rejoint alors
l’historique.

### Effectif ALM

L’effectif contient toujours 14 joueurs. Leur prénom est modifiable et chacun
peut avoir un numéro préféré facultatif de 1 à 999. Le prénom et le numéro
préféré sont repris lors de la préparation. Modifier un numéro sur la feuille
de match ne change pas la préférence. Deux joueurs peuvent avoir le même
numéro préféré dans l’effectif. Si les deux figurent sur la même feuille de
match, leurs numéros doivent être rendus uniques avant de démarrer. Modifier
l’effectif ne change pas les prénoms et les numéros déjà enregistrés dans un
match.

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
* La clôture de la 8e période et celle du match sont deux actions distinctes.
  Chaque clôture demande confirmation et est irréversible.
* L’annulation retire uniquement la dernière action de la période en cours.
  Elle ne peut pas modifier une période clôturée.
* Aucun chronomètre de match ou de possession n’est demandé.

## Enregistrement des actions et statistiques

Pour l’ALM, le choix de `+1`, `+2` ou d’une faute ouvre une grille de cases
carrées sur trois colonnes, triées par numéro de maillot croissant. Le dixième
joueur apparaît seul sur la quatrième ligne. La croix ferme cette grille.
L’action n’est enregistrée qu’après le choix d’un joueur ; fermer la grille ne
modifie pas le match.

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

Les actions réussies ne produisent pas de notifications en tête de page. Les
erreurs de validation, de stockage et d’import restent signalées.

## Données, continuité et confidentialité

Le carnet, le match actif, l’historique, l’effectif et le réglage des fautes sont
conservés sur l’appareil. Les données ne sont pas partagées entre le serveur de
prévisualisation, le site public ou un autre appareil. Le transfert s’effectue
par export puis import manuel. Pour installer l’application ou vérifier le
mode hors ligne, consultez le
[guide d’exploitation](./architecture-exploitation.md#mode-hors-ligne-et-mises-à-jour).

L’export JSON comprend l’effectif ALM, les réglages, les matchs terminés et
actifs ainsi que les sélections et actions correspondantes. L’import remplace
toutes les données du carnet après confirmation. Les exports sont en v2 et
les sauvegardes v1 compatibles restent importables. Un fichier invalide, trop
volumineux ou contenant un format de match non reconnu ne doit modifier aucune
donnée.

Effacer les données du navigateur, désinstaller l’application ou perdre
l’appareil peut supprimer le carnet. L’export régulier est donc nécessaire,
même si le navigateur accorde la protection du stockage persistant.

## Critères d’acceptation

* Le parcours de préparation refuse un nom adverse vide, moins de 6 ou plus de
  10 joueurs, ainsi que des numéros invalides ou dupliqués, y compris `04` et `4`.
  Les numéros préférés sont proposés en priorité. Sans préférence, la
  numérotation automatique démarre à 4 et suit l’ordre de sélection.
* Le score adverse ne demande jamais de joueur et les paniers ALM ne sont
  persistés qu’après sélection d’un joueur.
* Le sélecteur du marqueur affiche des cases carrées triées par numéro de
  maillot dans l’ordre numérique (9 avant 10). Avec dix joueurs, la grille
  comporte trois rangées de trois cases et une quatrième rangée d’une case.
* Les paniers repartent à zéro à chaque période ; les points de match et les
  fautes cumulées restent cohérents avec les actions enregistrées.
* Les pastilles des périodes distinguent les périodes gagnées, nulles, perdues
  et celles qui restent à jouer.
* Les confirmations empêchent une clôture accidentelle ; une période clôturée
  ne peut pas être annulée.
* Après la 8e période, l’écran de match affiche toujours le score et les
  statistiques, sans commandes de score ni d’annulation. Le bouton
  « Clôturer le match » reste disponible après rechargement. Tant que la
  clôture n’est pas confirmée, le match n’apparaît pas dans l’historique.
* Le match actif est retrouvé après rechargement ou réouverture du navigateur.
* L’historique conserve les résultats des huit périodes et autorise un résultat
  final nul.
* Une sauvegarde valide restaure les données après confirmation ; une
  sauvegarde invalide est rejetée sans écriture.
* Après la mise en cache initiale, l’application et le carnet restent
  utilisables hors ligne.
* Une mise à jour disponible s’applique sans notification lorsqu’aucun match
  n’est actif ; elle ne recharge pas l’application pendant un match actif.

Les tests automatisés associés se trouvent dans
[`src/domain.test.ts`](../src/domain.test.ts),
[`src/storage.test.ts`](../src/storage.test.ts),
[`src/App.test.tsx`](../src/App.test.tsx) et
[`e2e/app.spec.ts`](../e2e/app.spec.ts).
