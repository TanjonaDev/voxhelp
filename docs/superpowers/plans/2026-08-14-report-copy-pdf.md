# Copier / Télécharger PDF sur la fiche de qualification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter deux actions toujours visibles sur la fiche de qualification finale (`FinalReportView`) : copier le rapport en texte brut structuré dans le presse-papier, et le télécharger en PDF via l'impression native du navigateur.

**Architecture:** Un nouveau module pur `apps/web/src/lib/formatReport.ts` centralise toute la logique de formatage du rapport (comptage par statut, ligne de bilan, formatage de date, mapping icônes/labels), aujourd'hui dupliquée dans `FinalReportView`. `OverlayPanel.tsx` importe ce module au lieu de redéfinir cette logique localement, et l'utilise à la fois pour l'affichage écran (inchangé visuellement) et pour la sérialisation texte du bouton "Copier". Le bouton "Télécharger PDF" s'appuie sur `window.print()` et un bloc CSS `@media print` qui isole la fiche et force une palette claire — aucune nouvelle dépendance npm.

**Tech Stack:** TypeScript strict, ESM, React 19, CSS custom properties existantes (`apps/web/src/index.css`).

## Global Constraints

- TypeScript strict, pas de `any`.
- Aucune nouvelle dépendance npm.
- `apps/web/src/components/OverlayPanel.tsx` utilise des objets `style={{...}}` inline, pas Tailwind — tout le nouveau JSX doit suivre ce pattern et réutiliser les tokens CSS déjà en place (`var(--card)`, `var(--card-hi)`, `var(--stroke)`, `var(--text-2)`, `var(--text-3)`, `var(--good)`, `var(--warn)`, `var(--risk)`, `var(--mono)`, `var(--font)`).
- Une seule source de vérité pour le comptage par statut / la ligne de bilan (`techMatchingCounts`, `formatBilanLine`) et pour `formatInterviewDate` / les mappings `SKILL_STATUS_META` / `VERDICT_META` : ces éléments migrent de `OverlayPanel.tsx` vers `formatReport.ts` et sont importés, jamais redéfinis à deux endroits — c'est le principe central retenu dans le design pour éviter toute divergence entre l'écran et le texte copié.
- Pas de fallback presse-papier explicite (navigateur ancien / contexte non sécurisé) — `catch` silencieux.
- Aucune infra de test automatisé n'existe dans `apps/web` — vérification par `tsc --noEmit` et `pnpm --filter @voxhelp/web build`, plus smoke test manuel décrit dans la dernière tâche.

---

## Task 1: `apps/web/src/lib/formatReport.ts` — module de formatage centralisé

**Files:**
- Create: `apps/web/src/lib/formatReport.ts`

**Interfaces:**
- Consumes: `CandidateReport`, `SkillMatchStatus`, `Verdict` from `@voxhelp/shared`.
- Produces (tous exportés, consommés par Task 3) :
  - `SKILL_STATUS_META: Record<SkillMatchStatus, { icon: string; color: string }>`
  - `VERDICT_META: Record<Verdict, { label: string; colorVar: string }>`
  - `techMatchingCounts(matches: CandidateReport["techMatching"]): Record<SkillMatchStatus, number>`
  - `formatBilanLine(counts: Record<SkillMatchStatus, number>): string`
  - `formatInterviewDate(iso: string): string`
  - `formatReportAsText(report: CandidateReport): string`

- [ ] **Step 1: Créer le fichier**

Contenu complet de `apps/web/src/lib/formatReport.ts` :

```ts
import type { CandidateReport, SkillMatchStatus, Verdict } from "@voxhelp/shared";

export const SKILL_STATUS_META: Record<SkillMatchStatus, { icon: string; color: string }> = {
  "demontre": { icon: "✓", color: "var(--good)" },
  "mentionne": { icon: "?", color: "var(--warn)" },
  "non-aborde": { icon: "✕", color: "var(--risk)" },
};

export const VERDICT_META: Record<Verdict, { label: string; colorVar: string }> = {
  "presenter": { label: "Présenter au client", colorVar: "var(--good)" },
  "presenter-avec-reserve": { label: "Présenter avec réserve", colorVar: "var(--warn)" },
  "ne-pas-presenter": { label: "Ne pas présenter", colorVar: "var(--risk)" },
};

export function techMatchingCounts(matches: CandidateReport["techMatching"]): Record<SkillMatchStatus, number> {
  return matches.reduce(
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { "demontre": 0, "mentionne": 0, "non-aborde": 0 } as Record<SkillMatchStatus, number>
  );
}

export function formatBilanLine(counts: Record<SkillMatchStatus, number>): string {
  return `${counts["demontre"]} démontré${counts["demontre"] !== 1 ? "s" : ""} · ${counts["mentionne"]} mentionné${counts["mentionne"] !== 1 ? "s" : ""} · ${counts["non-aborde"]} non abordé${counts["non-aborde"] !== 1 ? "s" : ""}`;
}

export function formatInterviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export function formatReportAsText(report: CandidateReport): string {
  const counts = techMatchingCounts(report.techMatching);
  const lines: string[] = [];

  lines.push(`${report.candidateName} — ${report.jobTitle}`);
  lines.push(`${formatInterviewDate(report.interviewDate)} · ${report.durationLabel}`);
  lines.push("");
  lines.push("RÉSUMÉ");
  lines.push(report.summary);

  if (report.techMatching.length > 0) {
    lines.push("");
    lines.push("MATCHING TECHNIQUE");
    for (const m of report.techMatching) {
      const icon = (SKILL_STATUS_META[m.status] ?? SKILL_STATUS_META["non-aborde"]).icon;
      lines.push(`${icon} ${m.skill} — ${m.evidence}`);
      if (m.citation) lines.push(`  "${m.citation.quote}" (${m.citation.t})`);
    }
    lines.push("");
    lines.push(formatBilanLine(counts));
  }

  if (report.strengths.length > 0) {
    lines.push("");
    lines.push("POINTS FORTS");
    for (const s of report.strengths) {
      lines.push(`+ ${s.text}`);
      lines.push(`  "${s.citation.quote}" (${s.citation.t})`);
    }
  }

  if (report.attentionPoints.length > 0) {
    lines.push("");
    lines.push("POINTS D'ATTENTION");
    for (const a of report.attentionPoints) {
      lines.push(`? ${a.text}`);
      if (a.citation) lines.push(`  "${a.citation.quote}" (${a.citation.t})`);
    }
  }

  if (report.keyProjects.length > 0) {
    lines.push("");
    lines.push("PROJETS CLÉS IDENTIFIÉS");
    for (const p of report.keyProjects) {
      lines.push(`${p.company} · ${p.period}`);
      lines.push(`${p.role} — ${p.stack}`);
      lines.push(p.impact);
    }
  }

  lines.push("");
  const verdictLabel = (VERDICT_META[report.verdict] ?? VERDICT_META["presenter-avec-reserve"]).label;
  lines.push(`RECOMMANDATION : ${verdictLabel}`);
  lines.push(report.verdictReason);

  if (report.verdictChecklist.length > 0) {
    lines.push("");
    lines.push("Vérifications :");
    for (const c of report.verdictChecklist) lines.push(`- ${c}`);
  }

  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Prochaines étapes :");
    for (const s of report.nextSteps) lines.push(`- ${s}`);
  }

  if (report.suggestedQuestions.length > 0) {
    lines.push("");
    lines.push("QUESTIONS NON POSÉES");
    for (const q of report.suggestedQuestions) lines.push(`- ${q}`);
  }

  return lines.join("\n");
}
```

Ces définitions (`SKILL_STATUS_META`, `VERDICT_META`, `techMatchingCounts`, `formatInterviewDate`) sont une copie exacte du comportement actuellement en dur dans `apps/web/src/components/OverlayPanel.tsx:596-650` — ne rien changer à leur logique, seulement les déplacer ici. Elles seront supprimées de `OverlayPanel.tsx` dans la Task 3, qui importera ce module à la place.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS (le fichier compile seul, indépendant de React ; il n'est pas encore importé nulle part donc aucun changement de comportement à ce stade).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/formatReport.ts
git commit -m "feat(web): add centralized report formatting module (counts, bilan line, text export)"
```

---

## Task 2: `apps/web/src/components/ui.tsx` — icône `download`

**Files:**
- Modify: `apps/web/src/components/ui.tsx:8-26` (objet `VH_ICONS`)

**Interfaces:**
- Produces: une entrée `download` dans `VH_ICONS`, utilisable via `<VIcon name="download" />` (consommée par Task 3).

- [ ] **Step 1: Ajouter l'icône**

Dans `apps/web/src/components/ui.tsx`, insérer une nouvelle entrée juste après `check` (ligne 24) :

```ts
  check: "M20 6 9 17l-5-5",
  download: "M12 3v11M7 9l5 5 5-5M4 20h16",
  dot: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
```

(seule la ligne `download` est ajoutée ; `check` et `dot` existent déjà et sont montrées ici pour le point d'insertion exact).

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui.tsx
git commit -m "feat(web): add download icon"
```

---

## Task 3: `OverlayPanel.tsx` — boutons Copier / Télécharger PDF + bascule vers le module centralisé

**Files:**
- Modify: `apps/web/src/components/OverlayPanel.tsx:1-6` (imports)
- Modify: `apps/web/src/components/OverlayPanel.tsx:593-830` (bloc `FinalReportView` : suppression des définitions locales déplacées en Task 1, ajout des boutons)

**Interfaces:**
- Consumes: `formatReportAsText`, `techMatchingCounts`, `formatBilanLine`, `formatInterviewDate`, `SKILL_STATUS_META`, `VERDICT_META` (Task 1) ; icône `download` (Task 2).
- Produces: rien de consommé par une tâche suivante — Task 4 ajoute juste la règle CSS correspondant à la classe `report-actions` posée ici (le `className` sans règle CSS associée avant Task 4 est normal et n'a aucun effet visuel entre-temps).

- [ ] **Step 1: Mettre à jour les imports**

Remplacer les lignes 1-6 :

```ts
import { useState, useEffect, useRef } from "react";
import type { Insight, CandidateReport, JobContext, SkillMatch, SkillMatchStatus, Verdict, Citation } from "@voxhelp/shared";
import { useCvKeywords } from "../hooks/useCvKeywords.js";
import { deriveStackKeywords, mergeKeywords } from "../lib/mergeKeywords.js";
import { VIcon, VHMark, LiveWave, StatusBadge, CategoryTag, GhostBtn } from "./ui.js";
import type { PartialCard } from "../lib/parseAssistStream.js";
```

par :

```ts
import { useState, useEffect, useRef } from "react";
import type { Insight, CandidateReport, JobContext, Citation } from "@voxhelp/shared";
import { useCvKeywords } from "../hooks/useCvKeywords.js";
import { deriveStackKeywords, mergeKeywords } from "../lib/mergeKeywords.js";
import {
  formatReportAsText,
  techMatchingCounts,
  formatBilanLine,
  formatInterviewDate,
  SKILL_STATUS_META,
  VERDICT_META,
} from "../lib/formatReport.js";
import { VIcon, VHMark, LiveWave, StatusBadge, CategoryTag, GhostBtn } from "./ui.js";
import type { PartialCard } from "../lib/parseAssistStream.js";
```

`SkillMatch`/`SkillMatchStatus`/`Verdict` ne sont plus référencés directement dans ce fichier une fois les définitions locales supprimées à l'étape suivante (vérifié : leurs seules occurrences dans le fichier sont exactement les lignes supprimées par cette tâche) — ne pas les laisser dans l'import, `tsc --noEmit` échouerait sinon sur un import inutilisé si `noUnusedLocals` est actif, et sinon c'est un import mort à ne pas laisser traîner.

- [ ] **Step 2: Supprimer les définitions locales déplacées, remplacer par le module importé**

Supprimer entièrement les blocs suivants (maintenant fournis par `../lib/formatReport.js`) :
- `const SKILL_STATUS_META = {...}` (lignes 596-600)
- `const VERDICT_META = {...}` (lignes 602-606)
- `function techMatchingCounts(...) {...}` (lignes 634-642)
- `function formatInterviewDate(...) {...}` (lignes 644-650)

Garder `sectionLabelStyle` (608-615) et `CitationChip` (617-632) inchangés — ce ne sont pas des utilitaires de formatage de données, ils restent dans ce fichier.

- [ ] **Step 3: Réécrire le début de `FinalReportView` (state + calculs)**

Remplacer :

```ts
function FinalReportView({ report }: { report: CandidateReport }) {
  const verdict = VERDICT_META[report.verdict] ?? VERDICT_META["presenter-avec-reserve"];
  const counts = techMatchingCounts(report.techMatching);
  const bilanLine = `${counts["demontre"]} démontré${counts["demontre"] !== 1 ? "s" : ""} · ${counts["mentionne"]} mentionné${counts["mentionne"] !== 1 ? "s" : ""} · ${counts["non-aborde"]} non abordé${counts["non-aborde"] !== 1 ? "s" : ""}`;

  return (
```

par :

```ts
function ReportActionBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: "unset" as "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: 99,
        background: hover ? "var(--card-lift)" : "var(--card-hi)",
        boxShadow: "0 0 0 1px var(--stroke) inset",
        color: "var(--text-2)",
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: "var(--font)",
        transition: "background 0.15s",
      }}
    >
      <VIcon name={icon} size={12} />
      {label}
    </button>
  );
}

function FinalReportView({ report }: { report: CandidateReport }) {
  const verdict = VERDICT_META[report.verdict] ?? VERDICT_META["presenter-avec-reserve"];
  const counts = techMatchingCounts(report.techMatching);
  const bilanLine = formatBilanLine(counts);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatReportAsText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Presse-papier indisponible (contexte non sécurisé / navigateur ancien) — pas de fallback, hors scope.
    }
  };

  return (
```

- [ ] **Step 4: Ajouter `data-print-area` sur le conteneur racine**

Remplacer l'ouverture de la balise racine :

```tsx
    <div
      style={{
        gridColumn: "1 / -1",
```

par :

```tsx
    <div
      data-print-area
      style={{
        gridColumn: "1 / -1",
```

- [ ] **Step 5: Ajouter les deux boutons dans l'en-tête**

Remplacer le bloc de l'en-tête (section "1. En-tête") :

```tsx
      {/* 1. En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {report.candidateName}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>
            {report.jobTitle} · {formatInterviewDate(report.interviewDate)} · {report.durationLabel}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 9px",
            borderRadius: 99,
            background: "var(--card-hi)",
            color: verdict.colorVar,
            whiteSpace: "nowrap",
          }}
        >
          {verdict.label}
        </span>
      </div>
```

par :

```tsx
      {/* 1. En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {report.candidateName}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>
            {report.jobTitle} · {formatInterviewDate(report.interviewDate)} · {report.durationLabel}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: 99,
              background: "var(--card-hi)",
              color: verdict.colorVar,
              whiteSpace: "nowrap",
            }}
          >
            {verdict.label}
          </span>
          <div className="report-actions" style={{ display: "flex", gap: 6 }}>
            <ReportActionBtn
              icon={copied ? "check" : "copy"}
              label={copied ? "Copié !" : "Copier"}
              onClick={handleCopy}
            />
            <ReportActionBtn icon="download" label="Télécharger PDF" onClick={() => window.print()} />
          </div>
        </div>
      </div>
```

`report-actions` est la classe que la Task 4 masquera en impression (elle n'a aucun effet avant que cette règle CSS existe — pas d'incohérence intermédiaire).

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS, zéro erreur. Vérifier en particulier qu'il n'y a plus aucune référence à `SkillMatch`/`SkillMatchStatus`/`Verdict` en tant qu'imports de type inutilisés, et qu'aucune définition dupliquée de `SKILL_STATUS_META`/`VERDICT_META`/`techMatchingCounts`/`formatInterviewDate` ne subsiste dans ce fichier (`grep -n "^const SKILL_STATUS_META\|^const VERDICT_META\|^function techMatchingCounts\|^function formatInterviewDate" apps/web/src/components/OverlayPanel.tsx` doit être vide).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/OverlayPanel.tsx
git commit -m "feat(web): add copy and download-PDF actions to the final report header"
```

---

## Task 4: `apps/web/src/index.css` — bloc d'impression

**Files:**
- Modify: `apps/web/src/index.css` (ajout en fin de fichier)

**Interfaces:**
- Consumes: attribut `data-print-area` et classe `report-actions` posés en Task 3.
- Produces: rien consommé par une tâche suivante (dernière tâche de contenu).

- [ ] **Step 1: Ajouter le bloc `@media print`**

À la fin de `apps/web/src/index.css` (après le bloc `@media (prefers-reduced-motion: reduce)` existant, ligne 124-129), ajouter :

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

  [data-print-area] .report-actions {
    display: none;
  }
}
```

La dernière règle masque les boutons Copier/Télécharger PDF eux-mêmes dans le rendu imprimé/PDF — sans elle, ils apparaîtraient rendus dans le PDF final, ce qui n'a pas de sens pour un document destiné à être envoyé à un client.

- [ ] **Step 2: Vérifier que le CSS est syntaxiquement valide**

Run: `cd apps/web && pnpm build`
Expected: PASS — le build Vite/PostCSS/Tailwind échoue si le CSS est invalide ; ce build valide aussi tout le TypeScript du projet en une seule commande.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(web): print-optimized layout for the final report PDF export"
```

---

## Task 5: Vérification finale + smoke test manuel

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Typecheck complet**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS, zéro erreur.

- [ ] **Step 2: Build complet**

Run: `cd apps/web && pnpm build`
Expected: PASS.

- [ ] **Step 3: Grep de cohérence**

Run: `grep -rn "SkillMatch\b\|SkillMatchStatus\b" apps/web/src/components/OverlayPanel.tsx`
Expected: aucune sortie (confirme que Task 3 a bien retiré ces imports de type devenus inutiles).

- [ ] **Step 4: Smoke test manuel**

Run: `pnpm dev` depuis la racine du repo, puis dans le navigateur :
1. Dérouler une session jusqu'à obtenir un rapport final réel (ou réutiliser une session déjà en cours si un rapport est déjà généré).
2. Cliquer "Copier" → le bouton doit afficher brièvement "Copié !" avec une icône de validation, puis revenir à son état initial après ~1.5s. Coller le contenu du presse-papier dans un éditeur de texte et vérifier que la structure correspond au format décrit dans la spec (en-tête, RÉSUMÉ, MATCHING TECHNIQUE avec icônes ✓/?/✕ et citations horodatées, etc.).
3. Cliquer "Télécharger PDF" → la boîte de dialogue d'impression du navigateur doit s'ouvrir, avec un aperçu ne montrant que la fiche (pas le reste de l'overlay, pas les boutons Copier/Télécharger PDF eux-mêmes), sur fond blanc avec texte lisible.

Ce test est manuel car `apps/web` n'a aucune infra de test automatisé — cohérent avec le reste du composant.
