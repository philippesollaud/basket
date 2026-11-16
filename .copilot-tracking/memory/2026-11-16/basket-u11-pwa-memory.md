---
description: "Checkpoint de la PWA basketball U11 ALM implementee, validee et deployee sur Azure Static Web Apps."
ms.date: 2026-11-16
---

# Memory: basket-u11-pwa

Created: 2026-11-16T09:28:21.8088131+01:00
Last Updated: 2026-11-16T10:35:56.5647276+01:00

## Task Overview

PWA personnelle en francais pour suivre les matchs de basketball U11 sur
smartphone Android. L'application est implementee, testee et deployee en HTTPS.
Elle fonctionne hors ligne apres un premier chargement, sans backend, compte
utilisateur, base cloud ni synchronisation automatique. Les donnees restent sur
l'appareil, avec sauvegardes manuelles JSON.

Workspace : `C:\Repos\sandbox\basket`, qui n'est pas un depot Git.
L'operation du 16 novembre est uniquement un checkpoint SAVE dans ce fichier.
Ne pas confondre cette operation avec une autorisation de modifier l'application.
Cette sauvegarde remplace l'ancien etat de conception : les anciennes taches
d'implementation et decisions alors ouvertes sont maintenant resolues.

Conserver uniquement le contexte technique non sensible. Ne pas recopier les
noms personnels des joueurs ni les identifiants de compte ou d'abonnement Azure.
Consulter `src\domain.ts` pour l'effectif configure, sans le reproduire ici.

## Current State

### Application et fichiers

* PWA complete : React 19, TypeScript strict, Vite 8, CSS Modules, Dexie/IndexedDB, Zod et `vite-plugin-pwa` avec enregistrement en mode prompt.
* Interface mobile responsive en francais : Terrain (preparation), Effectif ALM, Historique et Sauvegardes.
* Demande de stockage persistant, instructions d'installation et protection `ErrorBoundary`.
* Shell en cache hors ligne ; mise a jour differee pendant un match actif, bouton manuel de mise a jour, aucun rechargement automatique pendant le match.
* Fichiers principaux : `src\App.tsx`, `src\App.module.css`, `src\index.css`, `src\domain.ts`, `src\storage.ts` et `src\ErrorBoundary.tsx`.
* Tests : `src\test\fixtures.ts`, `src\test\setup.ts`, `src\domain.test.ts`, `src\alm.test.ts`, `src\storage.test.ts`, `src\App.test.tsx` et `e2e\app.spec.ts`.
* Configuration : `playwright.config.ts`, `vitest.config.ts` et `vite.config.ts` ; icones publiques SVG et PNG 192/512.
* Hebergement : `public\staticwebapp.config.json` et `scripts\deploy.ps1`.

### Regles metier implementees

Les regles proviennent de l'utilisateur, pas d'une verification d'un reglement
officiel. `src\domain.ts` est la reference technique.

* Un match comporte huit periodes, chacune commencant avec un score de paniers de 0-0 ; seules les actions de 1 ou 2 points existent.
* Chaque periode rapporte 3 points de match au vainqueur, 1 au perdant ou 2 a chaque equipe en cas de nul.
* Le resultat final repose sur le total des points de match, pas sur le cumul des paniers ; une egalite finale est autorisee, sans prolongation.
* La cloture manuelle d'une periode demande confirmation et est irreversible.
* L'annulation concerne uniquement les scores et fautes de la periode courante ; elle ne revient jamais sur une cloture precedente.
* Aucun chronometre de match ou de possession n'est demande.
* L'effectif permanent ALM comporte 14 joueurs et est initialise dans `emptyData()` ; leurs noms sont editables, sans numero de maillot permanent.
* Exactement 10 joueurs sont selectionnes par match, avec des numeros numeriques uniques attribues pour ce match ; `04` et `4` sont des doublons invalides.
* ALM peut jouer a domicile ou a l'exterieur ; les nouveaux matchs ont `almSide: home/away`, les anciens restent compatibles avec `almSide: null`.
* Les instantanes du match conservent les noms et numeros au moment de sa creation, meme apres modification de l'effectif.
* L'adversaire a uniquement un nom, sans liste de joueurs ; ses boutons +1/+2 enregistrent directement des evenements avec `playerId: null`.
* Pour ALM, +1/+2 ouvre un dialogue de numero ; le score n'est persiste qu'apres selection du joueur. Annuler ne change rien ; une erreur permet de reessayer.
* `settings.trackFouls` est un reglage persistant de l'appareil, desactive par defaut. L'activer affiche le bouton et les statistiques de fautes ALM ; le desactiver les masque sans effacer les evenements passes.
* Les fautes individuelles se cumulent sur le match, sans sanction ni exclusion automatique.
* Les anciennes equipes et les anciens matchs sont conserves ; le suivi adverse sans joueurs remplace le besoin initial de saisir deux effectifs pour les nouveaux matchs.

### Persistance et sauvegardes

* Base Dexie `basket-u11`, etat `state/main`, revision avec concurrence optimiste et commits transactionnels.
* Version de base 2 : la migration depuis v1 conserve matchs et equipes et initialise ALM et les reglages.
* Sauvegardes JSON v2 strictement validees avec Zod ; import v1 compatible, limite de 10 Mo, aucun ecrit pour un import invalide.
* Les actions sont persistees pour permettre la reprise apres fermeture.
* Les donnees sont locales a l'origine web. L'historique du preview local n'apparait pas automatiquement sur le site public ou sur le telephone ; transfert manuel par export/import.

### Dernieres validations rapportees

Ces resultats proviennent du contexte fourni pour cette sauvegarde ; ils n'ont
pas ete reexecutes pendant le checkpoint.

* 68 tests Vitest reussis et 8 tests Playwright reussis (desktop et emulation Pixel 7).
* `npm run build` et `npm run lint` reussis.
* `npm audit` : aucune vulnerabilite runtime, 6 avis transitifs des outils de build (2 faibles, 4 moderes, deepmerge/glob/minimatch via Workbox). Aucun downgrade force.
* Node 26 installe, contrainte engines `>=22.12` ; aucune installation de dependances necessaire.
* Avertissement npm de configuration utilisateur `always-auth`, sans rapport avec le fonctionnement de l'application.

### Deploiement HTTPS termine

* L'utilisateur a explicitement choisi Azure Static Web Apps et `privacy=false` apres avertissement que l'effectif initial est inclus dans le bundle public. Aucune suppression de l'effectif n'a ete demandee.
* Site public : <https://nice-coast-02955ec03.6.azurestaticapps.net>.
* Ressources dediees : groupe `rg-basket-u11`, region `westeurope`, Static Web App `swa-basket-u11`, SKU Free.
* Deploiement effectue avec Azure CLI et son contexte d'authentification par defaut, sans integration GitHub ni commit Git.
* Seul `dist` a ete televerse ; les fichiers source, le carnet prive IndexedDB et les sauvegardes JSON ne l'ont pas ete. L'effectif initial embarque dans le bundle est public par choix explicite de l'utilisateur.
* `public\staticwebapp.config.json` configure `/sw.js` en no-store, index et manifeste en no-cache, assets hashes en immutable, fallback SPA, nosniff/referrer et MIME du manifeste.
* `scripts\deploy.ps1` exige `SubscriptionId`, accepte `ResourceGroup` et `AppName` (valeurs par defaut ci-dessus), construit puis deploie en production.
* Le script recupere le jeton de deploiement Azure dans l'environnement de facon transitoire, sans affichage ni stockage, puis restaure l'environnement.
* Commande de publication : `npx @azure/static-web-apps-cli@2.1.0 swa deploy .\dist --env production --no-use-keychain`. Le CLI est dans le cache npx ; `az` est disponible.
* Verification deploiement : HTTPS 200 pour page principale, service worker, manifeste et icones ; SKU Free confirme, aucune erreur de cache.
* Verification independante dans un Chromium Playwright neuf, viewport mobile 390 : controle par service worker, rechargement hors ligne reussi, 14 joueurs dans l'effectif, aucun debordement horizontal.
* L'installation sur un appareil Android physique n'a pas encore ete effectuee.

## Important Discoveries

### Decisions et contraintes de continuite

* L'export manuel suffit ; ne pas reintroduire de synchronisation cloud ou de besoin multiappareil automatique.
* Effacer les donnees du navigateur peut supprimer le carnet. Rappeler les exports reguliers et l'import manuel lors d'un changement d'origine ou d'appareil.
* L'annulation inter-periodes n'est plus une question ouverte : une cloture est irreversible et l'annulation reste dans la periode courante.
* Aucun developpement fonctionnel n'est en attente ; seules la verification physique Android et d'eventuelles nouvelles demandes utilisateur restent possibles.
* Les identifiants Azure necessaires a une publication ulterieure doivent etre fournis ou retrouves de facon securisee ; ne pas les sauvegarder ici.

### Pieges et tentatives a ne pas repeter

* Dans Playwright, `getByRole('combobox', { name: 'ALM joue', exact: true })` fonctionne, alors que `getByLabel` exact a expire.
* La case persistante de suivi des fautes se met a jour apres l'ecriture asynchrone : utiliser `click()` puis une attente `expect(...).toBeChecked()`, pas une hypothese de mise a jour immediate.
* L'evenement de telechargement du navigateur integre a expire ; le vrai telechargement JSON puis l'import ont reussi dans Playwright independant.
* Le controle hors ligne du site public dans le navigateur integre a retourne plusieurs handles differes. Le retour en ligne a ete visible et le controle Playwright shell independant a reussi ; ne pas sonder les handles perimes.
* Handles perimes a eviter : `2ed76f77-a762-4ff9-b957-7cbda4f19615` et `c70e2ed6-41e2-4d46-a583-88890e100e32`.
* Ne pas relancer des installations ou forcer un downgrade pour les avis de build deja identifies.

## Next Steps

1. Sur le telephone Android physique, ouvrir le site public dans Chrome, attendre "Pret hors ligne", puis installer via le menu Installer/Ajouter a l'ecran d'accueil et verifier le lancement et le fonctionnement en mode avion.

Apres cette verification, aucune tache fonctionnelle n'est ouverte. Selon les
besoins, rappeler les sauvegardes JSON et traiter les changements ulterieurs
demandes par l'utilisateur. Aucune modification applicative n'est autorisee par
la seule commande de checkpoint.

## Context to Preserve

### Sessions et ressources locales

* Le preview local a ete laisse disponible sur <http://127.0.0.1:4173>, processus detache `shellId: basket-preview`, commande `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`.
* Cette disponibilite est l'etat rapporte avant sauvegarde, pas une verification de processus pendant le checkpoint ; verifier avant reutilisation, sans demarrer de doublon inutile.
* Page locale du navigateur partage : `7793889c-9389-46c8-88ef-9db2a985fbe8`.
* Page publique du navigateur partage : `8db7b5ed-57a5-4ec8-9534-605d50c41137`.
* Les donnees de test locales avaient ete supprimees ; aucun nouveau match de test n'a ete cree sur les pages partagees.
* Le site public et le preview local sont deja enregistres comme artefacts ; ne pas les enregistrer de nouveau sans raison.

### Sources et agents

* Source du contexte restaure : demande utilisateur detaillee de checkpoint SAVE du 2026-11-16, decrivant implementation, validations et deploiement termines.
* La detection a lu l'ancien checkpoint avant remplacement. Il decrivait seulement la conception et six taches de developpement ; cet etat est obsolete.
* Consignes Markdown et style lues dans les fichiers `markdown.instructions.md` et `writing-style.instructions.md` de l'extension HVE Core 3.2.2 avant edition ; aucune consigne locale applicable trouvee lors de la detection.
* Cette operation ne modifie que ce checkpoint, via `apply_patch`, sans changement applicatif, installation, test de l'application ou action Azure.
* Aucun agent personnalise autre que Memory n'a ete invoque ; aucun transfert obligatoire vers un agent specialiste.
* Questions ouvertes : 0. Taches en attente : 1 (verification Android physique).
* Reprise : executer `/clear` puis `/checkpoint continue basket-u11-pwa`.
