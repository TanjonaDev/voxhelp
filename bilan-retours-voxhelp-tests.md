# Bilan de test — VoxHelp Recruit (analyse live)
**Contexte :** 2 sessions de test réel sur un entretien candidat backend Node.js/TS AWS Serverless (RMC BFM / CMS Cléo). STT : Deepgram Flux. Objectif : lister les problèmes observés pour spec + implémentation des correctifs.

---

## 1. Sur-génération de cards sur un même tour de parole

**Constat :** un déclencheur "analyse après 3 min de monologue" génère jusqu'à 4 cards distinctes sur une seule réponse candidat (ex : capture-1-test-1, cards à 00:49, 01:27, 01:36, 01:49 — quelques secondes d'écart entre elles).

**Problème :** le déclenchement est purement temporel, pas sémantique. Résultat : contenu redondant entre cards ("Stack technique maîtrisée" et "Portefeuille de projets data concrets" disent la même chose ; "Jargon décodé — intégration d'APIs" et "DynamoDB comme couche de persistance" décrivent le même pipeline sous deux angles). Surcharge cognitive pour un recruteur qui doit lire en temps réel pendant qu'il écoute.

**Piste de correctif :**
- Remplacer/compléter le seuil "3 min" par une détection de rupture sémantique (nouveau sous-thème abordé) plutôt qu'un minuteur fixe.
- Plafonner à 1-2 cards max par tour de parole candidat : si plusieurs angles sont détectés, les fusionner dans une seule card avec plusieurs puces plutôt que multiplier les cards.
- À spécifier : la fenêtre de déduplication doit comparer le contenu sémantique des cards générées sur une fenêtre glissante (ex : 90s) avant émission, pas juste le timer.

---

## 2. Chevauchement entre les types de cards "Traduction" et "Jargon décodé"

**Constat :** sur le sujet `unknown` vs `any`, le même contenu est expliqué deux fois quasi identiquement — une fois en card "Traduction", une fois en card "Jargon décodé" (capture-2-test-1 et capture-2-test-2).

**Problème :** pas de frontière claire entre les deux types de cards actuellement.

**Piste de correctif :** redéfinir la règle de déclenchement :
- **Traduction** = reformulation vulgarisée de ce qui vient d'être dit par le candidat.
- **Jargon décodé** = déclenché uniquement quand un terme technique *nouveau* apparaît, n'a pas encore été couvert dans la session, et nécessite une définition autonome (indépendante de la réponse du candidat).
- À implémenter : garder un état de session (liste des concepts déjà "décodés") pour éviter la redite sur un même entretien.

---

## 3. Erreur de transcription sur nom propre (CMS "Cléo" → "Clés Haut")

**Constat :** capture-1-test-2, card "Parcours et contexte actuel clarifié" — le CMS est restitué comme **"Clés Haut"** au lieu de **"Cléo"**, alors que le nom est correctement utilisé ailleurs dans la même session.

**Problème :** possible erreur Deepgram Flux sur nom propre isolé, ou "complétion" hallucinée côté LLM lors de la synthèse de la card.

**Pistes de correctif :**
- Activer le **keyword boosting** Deepgram Flux avec une liste de termes fournie en amont de l'entretien (nom d'entreprise, nom du CMS/outils internes, noms propres mentionnés dans l'offre ou le CV).
- Ajouter un champ côté produit permettant au recruteur de renseigner ces termes avant de lancer la session (nom entreprise, produit interne, stack spécifique).
- Ajouter un garde-fou côté prompt LLM : ne pas reformuler un nom propre différemment d'une occurrence à l'autre dans la même session — réutiliser le terme tel qu'il apparaît la première fois qu'il est validé/répété par le candidat.

---

## 4. Incohérence factuelle entre deux cards sur le même segment

**Constat :** deux cards distinctes sur la composition de l'équipe data se contredisent :
- Card A : "backend majoritaire + data engineers", collaboration avec l'équipe produit du CMS.
- Card B : "data engineers, DevOps et backends", collaboration avec "l'équipe produit" (nom du CMS non repris, terme générique).

**Problème :** deux cards générées sur un contenu source proche divergent sur les faits rapportés. Risque de casser la confiance utilisateur (pire qu'un bug UI classique).

**Piste de correctif :**
- Lié au point 1 : si la déduplication sémantique est en place, ce cas de double-génération sur la même info source devrait disparaître mécaniquement.
- En complément, envisager un passage de cohérence : avant émission d'une nouvelle card, vérifier qu'elle ne contredit pas une card déjà émise sur le même segment/sujet dans la session (comparaison factuelle légère, pas juste sémantique).

---

## 5. Card "Amorce de réponse" sans valeur ajoutée

**Constat :** une card s'affiche avec le contenu "impossible d'analyser pour le moment" et une relance "attendez la suite de sa réponse avant d'intervenir".

**Problème :** cette card n'apporte aucune information actionnable, c'est du bruit visuel qui casse la lisibilité du flux de cards.

**Piste de correctif :** ne pas émettre de card quand l'analyse juge le segment insuffisant/inexploitable. Soit supprimer l'émission, soit remplacer par un état d'interface discret (ex : indicateur "en cours d'écoute") plutôt qu'une card au même format que les cards à valeur.

---

## 6. Relances de questions parfois trop techniques pour un recruteur non-tech

**Constat :** certaines questions de relance générées restent formulées en jargon pur (ex : *"Comment gérez-vous le versioning et les migrations de ce package interne quand le schéma doit évoluer ? (rétrocompatibilité, déploiement coordonné des Lambdas)"*).

**Problème :** un recruteur non-tech peut lire la question à voix haute, mais ne pourra pas juger la qualité/pertinence de la réponse du candidat qui suit, faute de repère.

**Piste de correctif :** accompagner les relances jugées "techniques" (à définir : score de technicité ou détection de jargon dans la question générée elle-même) d'un mini repère additionnel type "à quoi ressemble une bonne réponse" — 1-2 signaux courts que le recruteur peut cocher mentalement en écoutant, sans avoir à comprendre le détail technique.

---

## 7. Point positif à préserver — le bilan de fin d'entretien

Le format du bilan final (points forts / points à creuser / verdict "À revoir") est jugé très réussi : clair, sans jargon inutile, verdict lisible immédiatement. **À utiliser comme référence de ton et de niveau de synthèse** pour recalibrer les cards en direct (point 6), en version plus condensée adaptée au temps réel.

---

## Résumé priorisé pour la spec

| # | Problème | Priorité | Type de fix |
|---|---|---|---|
| 1 | Sur-génération de cards (trigger temporel seul) | Haute | Logique de déclenchement / dédup sémantique |
| 4 | Incohérence factuelle entre cards | Haute | Dépend du fix #1 + contrôle de cohérence |
| 3 | Erreur transcription nom propre | Haute | Config Deepgram (keyword boosting) + prompt LLM |
| 2 | Chevauchement Traduction / Jargon décodé | Moyenne | Redéfinition des règles de déclenchement par type |
| 5 | Card "Amorce de réponse" inutile | Moyenne | Condition d'émission |
| 6 | Relances trop techniques pour non-tech | Moyenne | Enrichissement du prompt de génération de relance |
