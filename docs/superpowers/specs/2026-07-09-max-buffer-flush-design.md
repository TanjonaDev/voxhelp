# Flush forcé du transcript après 3 minutes de monologue continu

## Contexte

Le live-assist analyse le discours du candidat par blocs, délimités par un debounce de 1,5s (`session.ts` — `DEBOUNCE_MS`) qui se réinitialise à chaque nouveau tour détecté par Deepgram Flux. Si le candidat ne marque jamais de pause de plus de 1,5s pendant un monologue de 7-10 minutes, tout le texte s'accumule dans `transcriptBuffer` sans être analysé, et part en un seul bloc géant une fois qu'une pause survient enfin (ou jamais, si le monologue se termine sans pause détectable). Résultat : aucune carte n'apparaît pendant le monologue, et l'analyse finale est trop générique pour un contenu aussi long.

## Décision

Ajouter un second timer, indépendant du debounce de pause, qui force un flush + analyse après 3 minutes d'accumulation continue, même sans pause détectée.

## Comportement

- Nouvelle constante `MAX_BUFFER_MS = 3 * 60 * 1000` (3 minutes) dans `Session`.
- Nouveau champ `maxBufferTimer: ReturnType<typeof setTimeout> | null`.
- Le timer démarre uniquement quand `transcriptBuffer` passe de vide à non-vide (premier morceau d'un nouveau cycle d'accumulation) — il n'est **jamais réinitialisé** par les tours suivants, contrairement au debounce.
- À l'expiration du timer (3 min) :
  - annuler le `debounceTimer` en cours s'il existe (évite un double flush du même contenu),
  - vider `transcriptBuffer` et lancer `processTranscript` avec le contenu accumulé (ou passer par `pendingTranscript` si `isProcessing` est vrai — même règle que le flush par pause),
  - remettre `maxBufferTimer` à `null`.
- Tout flush (par pause **ou** par le timer 3 min) annule et remet à zéro `maxBufferTimer`, puisqu'un nouveau cycle d'accumulation recommence.
- `cleanup()` doit aussi clear `maxBufferTimer` (comme il le fait déjà pour `debounceTimer`).

## Hors scope

- Rendre `MAX_BUFFER_MS` configurable via variable d'environnement (constante en dur, cohérent avec `DEBOUNCE_MS`/`MAX_LOG_ENTRIES` existants).
- Découpage par nombre de mots/caractères — uniquement basé sur la durée, comme demandé.
