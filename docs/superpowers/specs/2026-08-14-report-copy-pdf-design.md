# Copier / Télécharger PDF sur la fiche de qualification

## Contexte

La fiche de qualification finale (`FinalReportView`, `apps/web/src/components/OverlayPanel.tsx`) est un document que le recruteur doit pouvoir transmettre à son client (CTO, DRH). Aujourd'hui elle n'est consultable qu'à l'écran, dans l'overlay — aucun moyen de l'extraire. Le bouton "copier" avait été explicitement mis hors scope lors de la conception initiale (`docs/superpowers/specs/2026-08-05-fiche-qualification-client-design.md`, "Hors scope") ; il revient maintenant, accompagné d'un export PDF.

## Décision

Deux actions, toujours visibles (pas de hover à découvrir) dans le coin supérieur droit de la carte, à côté du badge de verdict :

- **Copier** : sérialise le rapport en texte brut structuré (sections en majuscules, puces `+`/`?`/`✓`/`✕`, citations entre guillemets avec timestamp) et le pousse dans le presse-papier via `navigator.clipboard.writeText`. Format choisi pour être lisible tel quel dans n'importe quel client mail/Slack, sans dépendre d'un rendu Markdown.
- **Télécharger PDF** : déclenche `window.print()`. Pas de nouvelle dépendance npm : le navigateur gère nativement l'impression/export PDF via sa boîte de dialogue. Un bloc CSS `@media print` isole la fiche du reste de l'overlay et force une palette claire pour l'impression, en s'appuyant sur le fait que tout le style de `FinalReportView` passe déjà par les custom properties CSS globales (`--card`, `--text`, `--good`, etc.) — les redéfinir localement à l'impression suffit, aucun changement de composant nécessaire.

Pas de fallback explicite si `navigator.clipboard` est indisponible (contexte non sécurisé / navigateur ancien) : le `catch` reste silencieux, cohérent avec le reste de l'app qui cible un navigateur moderne en HTTPS/localhost (déjà une hypothèse pour la capture audio).

## Comportement

### 1. `apps/web/src/lib/formatReport.ts` (nouveau fichier)

```ts
export function formatReportAsText(report: CandidateReport): string
```

Fonction pure, aucune dépendance React. `techMatchingCounts` et la construction de la ligne de bilan (`X démontré(s) · Y mentionné(s) · Z non abordé(s)`), aujourd'hui définies localement dans `FinalReportView` (`OverlayPanel.tsx`), sont déplacées dans ce nouveau fichier et exportées (`techMatchingCounts`, `formatBilanLine`) — `OverlayPanel.tsx` les importe pour l'affichage écran au lieu de les redéfinir. Une seule source de vérité pour ce calcul, partagée entre l'écran et le texte copié, plutôt que deux implémentations qui pourraient diverger. Sortie de `formatReportAsText` :

```
{candidateName} — {jobTitle}
{date formatée} · {durationLabel}

RÉSUMÉ
{summary}

MATCHING TECHNIQUE
✓ {skill} — {evidence}
  "{quote}" ({t})
? {skill} — {evidence}
  "{quote}" ({t})
✕ {skill} — {evidence}

{n} démontré(s) · {n} mentionné(s) · {n} non abordé(s)   (même chaîne, avec accords singulier/pluriel, que la ligne de bilan affichée à l'écran)

POINTS FORTS
+ {text}
  "{quote}" ({t})

POINTS D'ATTENTION
? {text}
  "{quote}" ({t})    (ligne omise si pas de citation)

PROJETS CLÉS IDENTIFIÉS
{company} · {period}
{role} — {stack}
{impact}

RECOMMANDATION : {label du verdict}
{verdictReason}

Vérifications :
- {item}             (bloc omis si verdictChecklist vide)

Prochaines étapes :
- {step}

QUESTIONS NON POSÉES
- {question}
```

Sections vides (`keyProjects`, `suggestedQuestions`, etc.) omises entièrement, comme à l'affichage.

### 2. `apps/web/src/components/ui.tsx` — icône `download`

Ajout dans `VH_ICONS` :

```ts
download: "M12 3v11M7 9l5 5 5-5M4 20h16",
```

Même style que les icônes existantes (viewBox 24×24, stroke via `VIcon`, pas de nouveau composant).

### 3. `apps/web/src/components/OverlayPanel.tsx` — `FinalReportView`

- Le conteneur racine de `FinalReportView` reçoit `data-print-area` (attribut HTML, pas une classe — évite tout conflit avec le système de style inline existant).
- Nouveau petit composant local `ReportActionBtn` (icône + label, pilule `var(--card-hi)` / `var(--stroke)`, même famille visuelle que le badge de verdict) — pas exporté dans `ui.tsx`, un seul lieu d'usage.
- Deux instances dans l'en-tête, sous le badge de verdict :
  - `ReportActionBtn` "Copier" (icône `copy`) : `onClick` appelle `formatReportAsText(report)` puis `navigator.clipboard.writeText(...)`, avec un state local `copied` (icône → `check`, label → "Copié !" pendant 1.5s), `try/catch` silencieux en cas d'échec du clipboard.
  - `ReportActionBtn` "Télécharger PDF" (icône `download`) : `onClick` appelle `window.print()`.

### 4. `apps/web/src/index.css` — bloc `@media print`

```css
@media print {
  body * {
    visibility: hidden;
  }
  [data-print-area],
  [data-print-area] * {
    visibility: visible;
  }
  [data-print-area] {
    position: absolute;
    inset: 0;
    background: white;
    color: black;
    --card: white;
    --card-hi: #f4f4f5;
    --stroke: #d4d4d8;
    --text: #18181b;
    --text-2: #3f3f46;
    --text-3: #71717a;
    --good: #16a34a;
    --warn: #b45309;
    --risk: #dc2626;
    --shadow-card: none;
  }
}
```

Technique `visibility` (pas `display: none`) pour ne pas casser la mise en page du reste de la page pendant que le navigateur calcule l'impression.

## Hors scope

- Pas de fallback presse-papier pour navigateur non sécurisé/ancien — `catch` silencieux.
- Pas de bibliothèque de génération PDF côté client (jsPDF, html2canvas) — le rendu passe entièrement par l'impression native du navigateur.
- Pas de mise en page imprimée spécifique au-delà du changement de palette (pas de saut de page contrôlé entre sections, pas d'en-tête/pied de page personnalisés) — si le rendu d'impression s'avère insatisfaisant en usage réel, un ajustement CSS `@media print` plus poussé sera traité séparément.
- Pas de tests automatisés — aucune infra de test frontend n'existe dans `apps/web` à ce jour (cohérent avec le reste du composant) ; vérification par typecheck + smoke test manuel.

## Tests

- **Typecheck** : `cd apps/web && npx tsc --noEmit`.
- **Smoke test manuel** (`pnpm dev`) : générer un rapport final réel, cliquer "Copier" → coller le résultat dans un éditeur de texte et vérifier la structure ; cliquer "Télécharger PDF" → vérifier que la boîte de dialogue d'impression n'affiche que la fiche, sur fond clair, lisible.
