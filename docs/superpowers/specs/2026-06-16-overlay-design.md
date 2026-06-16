# VoxHelp Overlay — Spec d'implémentation

**Date** : 2026-06-16  
**Source** : `design_handoff_voxhelp_overlay/README.md`  
**Fidélité** : haute (pixel-perfect sur couleurs, typographie, espacements, animations)

---

## 1. Périmètre

Remplacement complet de `apps/web/src/components/LiveView.tsx` par un panneau de verre glass-panel haute fidélité, branché sur le pipeline WebSocket existant. Inclut la mise à jour du type `InsightCard` → `Insight` dans le package partagé et l'adaptation du backend pour produire cette forme.

**Hors scope** : intégration Electron, panneau Tweaks, toggle de langue EN/FR (on fixe FR), Prep/Report steps.

---

## 2. Changements Backend & Types partagés

### 2.1 `packages/shared/src/index.ts`

Remplacer `InsightCard` par `Insight` :

```ts
export interface Insight {
  id: string;
  cat: 'translation' | 'jargon' | 'strength' | 'risk' | 'level';
  confidence: 'confirmed' | 'partial' | 'low';
  t: string;           // horodatage dans l'appel, ex: '07:31'
  title: string;
  body: string;
  relance?: string;
  level?: number;      // 0–1, seulement pour cat === 'level'
  levelLabel?: string; // 'Junior' | 'Intermédiaire' | 'Senior' | 'Lead'
}
```

Mettre à jour `ServerMessage` : `{ type: 'assist:card'; card: Insight }`.  
Supprimer `CandidateReport` (ou conserver pour la suite — hors scope ici).  
Mettre à jour `createId()` si nécessaire (déjà présent).

### 2.2 `apps/backend/src/prompts/live-assist.ts`

Mettre à jour le prompt JSON pour demander à Claude de produire un objet `Insight` :

```
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "id": "<uuid-court>",
  "cat": "translation" | "jargon" | "strength" | "risk" | "level",
  "confidence": "confirmed" | "partial" | "low",
  "t": "<MM:SS depuis le début de la session>",
  "title": "<titre court, max 80 chars>",
  "body": "<explication en langage clair, 1-3 phrases>",
  "relance": "<question de relance ou null>",
  "level": <0.0–1.0 si cat=level, sinon omis>,
  "levelLabel": "<Junior|Intermédiaire|Senior|Lead si cat=level, sinon omis>"
}
```

### 2.3 `apps/backend/src/session.ts`

- Calculer `t` (elapsed depuis `sessionStart`) lors de la production de la carte.
- Générer `id` via `createId()` si Claude ne le produit pas correctement.
- Typer `card` comme `Insight` à la réception.

---

## 3. Architecture Frontend

### 3.1 Arborescence

```
apps/web/src/
├── components/
│   ├── overlay/
│   │   ├── OverlayPanel.tsx      — composant racine
│   │   ├── PanelHeader.tsx       — logo + statut pill
│   │   ├── LiveCaption.tsx       — bande transcription live
│   │   ├── InsightCardView.tsx   — carte insight
│   │   ├── CommandBar.tsx        — pills + input + footer recording
│   │   └── primitives/
│   │       ├── VHMark.tsx        — logo carré dégradé + waveform
│   │       ├── LiveWave.tsx      — barres audio animées
│   │       ├── Confidence.tsx    — 3 dots de confiance
│   │       ├── CategoryTag.tsx   — puce icône colorée + label
│   │       └── GhostBtn.tsx      — bouton icône fantôme
│   └── LiveView.tsx              — SUPPRIMÉ (remplacé par OverlayPanel)
└── index.css                     — +tokens CSS +keyframes VH
```

`App.tsx` importe `OverlayPanel` à la place de `LiveView`.

### 3.2 Props de `OverlayPanel`

```ts
interface OverlayPanelProps {
  insights: Insight[];
  isAnalyzing: boolean;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: (jobContext?: JobContext) => Promise<void>;
  onStop: () => void;
}
```

`isSummarizing`, `finalReport`, `onSummarize` : conservés mais rendus en bas du feed comme carte bilan glass (adaptation hors spec handoff).

### 3.3 État interne de `OverlayPanel`

| State | Type | Rôle |
|---|---|---|
| `status` | `'listening' \| 'speaking' \| 'analyzing' \| 'idle'` | dérivé des props |
| `newId` | `string \| null` | id dernière carte (déclenche glow) |
| `capIdx` | `number` | index caption live courante |
| `elapsed` | `number` | secondes depuis `isCapturing = true` |
| `jobTitle/Level/Stack` | `string` | formulaire pre-session |

Dérivation du statut :
```ts
const status = !isCapturing ? 'idle'
  : isAnalyzing ? 'analyzing'
  : isSpeaking  ? 'speaking'
  : 'listening';
```

---

## 4. Design tokens CSS

Ajoutés dans `apps/web/src/index.css` (bloc `:root`) :

```css
/* Glass surfaces */
--panel: hsl(222 28% 9% / 0.52);
--card:  hsl(0 0% 100% / 0.045);
--card-hi: hsl(0 0% 100% / 0.075);
--card-lift: hsl(0 0% 100% / 0.10);
--stroke:   hsl(0 0% 100% / 0.10);
--stroke-2: hsl(0 0% 100% / 0.16);

/* Texte */
--text:   hsl(0 0% 100% / 0.95);
--text-2: hsl(0 0% 100% / 0.62);
--text-3: hsl(0 0% 100% / 0.40);

/* Accents oklch */
--indigo: oklch(0.70 0.14 268);
--violet: oklch(0.70 0.16 300);
--cyan:   oklch(0.75 0.12 212);
--good:   oklch(0.76 0.15 158);
--warn:   oklch(0.81 0.13 80);
--risk:   oklch(0.72 0.16 25);
--accent: var(--indigo);

/* Soft variants (16% alpha) */
--indigo-soft: oklch(0.70 0.14 268 / 0.16);
--violet-soft: oklch(0.70 0.16 300 / 0.16);
--cyan-soft:   oklch(0.75 0.12 212 / 0.16);
--good-soft:   oklch(0.76 0.15 158 / 0.16);
--warn-soft:   oklch(0.81 0.13 80  / 0.16);
--risk-soft:   oklch(0.72 0.16 25  / 0.16);
--accent-soft: var(--indigo-soft);

/* Ombres */
--shadow-panel: 0 1px 0 hsl(0 0% 100% / .08) inset,
                0 24px 70px -12px hsl(230 40% 4% / .7),
                0 8px 28px -8px hsl(230 40% 4% / .55);
--shadow-card:  0 1px 0 hsl(0 0% 100% / .06) inset,
                0 8px 24px -10px hsl(230 40% 4% / .5);

/* Géométrie */
--radius-panel: 26px;
--radius-card:  18px;

/* Typo */
--font: 'Onest', system-ui, sans-serif;
--mono: 'JetBrains Mono', monospace;
```

**Google Fonts** : ajouter Onest (400/500/600/700) dans `index.html`.

### Keyframes

```css
@keyframes vh-thought-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
@keyframes vh-glow-fade {
  0%   { opacity: 0.5; }
  100% { opacity: 0; }
}
@keyframes vh-bar {
  0%, 100% { transform: scaleY(0.4); }
  50%       { transform: scaleY(1); }
}
@keyframes vh-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes vh-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.85); }
}
@keyframes vh-float {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-3px); }
}
@keyframes vh-caption-in {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

## 5. Composants détaillés

### `OverlayPanel` (racine)

Layout plein écran avec fond sombre (`bg-[#0d1117]`) pour simuler la visio derrière. Le panneau de verre est positionné à droite, `top: 18px; bottom: 18px; right: 18px; width: 400px`.

```
fond noir (simulate visio)
└── panneau verre (position: fixed, right:18, top:18, bottom:18, w:400)
    ├── PanelHeader         flex-shrink-0
    ├── LiveCaption         flex-shrink-0  (masqué si idle)
    ├── label "ANALYSE EN DIRECT · N"  flex-shrink-0
    ├── feed (overflow-y-auto, flex-1)
    │   ├── InsightCardView × N
    │   ├── skeleton si isAnalyzing
    │   └── FinalReportCard si finalReport
    └── CommandBar          flex-shrink-0
```

### `PanelHeader`

- `VHMark` 30px avec `glow={status === 'speaking' || status === 'analyzing'}`
- Titre "VoxHelp" 15.5px/700, sous-titre rôle 11.5px `var(--text-3)`
- Status pill selon `status` :
  - `listening` → dot vert pulsant + "En écoute"
  - `speaking` → `LiveWave` vert + "Candidat parle"
  - `analyzing` → spinner conic-gradient + "Analyse…" en `var(--accent)`
  - `idle` → dot gris + "En attente"
- `GhostBtn` eye (no-op pour l'instant)

### `LiveCaption`

Masquée si `status === 'idle'`. Caption = `CAPTIONS[capIdx % CAPTIONS.length]`. Captions FR hardcodées dans le composant (3 phrases). `capIdx` incrémenté à chaque passage en `speaking`.

### `InsightCardView`

Reprend exactement la spec §5.3 du README :
- Rail accent 3px gauche, couleur de `cat`
- Ligne du haut : `CategoryTag` + spacer + timestamp mono + `Confidence` (dots seulement)
- Titre 14.5px/600
- Level meter si `cat === 'level'`
- Corps "CE QUE ÇA VEUT DIRE" + body
- Sous-carte relance si `relance` présent
- Actions hover (Copier, Épingler)
- `animation: vh-thought-in` + ring `vh-glow-fade` si `isNew`

### `CommandBar`

3 pills (Assister/Relances/Récap), input "Demandez à VoxHelp…", footer recording (dot rouge + timer + bouton Arrêter qui appelle `onStop`).

### Primitives

- `VHMark` : div carré `linear-gradient(150deg, var(--indigo), var(--violet))`, 4 `<span>` barres animées `vh-bar` si `glow`
- `LiveWave` : N barres animées `vh-bar` avec décalages
- `Confidence` : 3 dots colorés selon `confirmed`/`partial`/`low`
- `CategoryTag` : puce 22px + label uppercase coloré
- `GhostBtn` : button `all: unset` avec hover via state

---

## 6. Interactions

- **Auto-scroll** : `useEffect` sur `insights.length` + `isAnalyzing` → `feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })`
- **Copier** : `navigator.clipboard.writeText(...)`, icône → check 1.4s via `setTimeout`
- **Épingler** : toggle local `pinned` (state dans `InsightCardView`)
- **newId** : dans `OverlayPanel`, `useEffect` sur `insights` → si nouvelle carte détectée, setNewId(card.id), puis `setTimeout(1s)` → setNewId(null)
- **capIdx** : `useEffect` sur `isSpeaking` → si `true`, incrémenter

---

## 7. Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `packages/shared/src/index.ts` | Modifier — `InsightCard` → `Insight`, update `ServerMessage` |
| `apps/backend/src/prompts/live-assist.ts` | Modifier — prompt JSON → forme `Insight` |
| `apps/backend/src/session.ts` | Modifier — typage `Insight`, calcul `t` |
| `apps/web/index.html` | Modifier — ajouter Google Fonts Onest |
| `apps/web/src/index.css` | Modifier — tokens + keyframes |
| `apps/web/tailwind.config.js` | Modifier — ajouter Onest, garder JetBrains Mono |
| `apps/web/src/App.tsx` | Modifier — import `OverlayPanel` au lieu de `LiveView` |
| `apps/web/src/components/LiveView.tsx` | Supprimer |
| `apps/web/src/components/overlay/` | Créer — 5 composants + 5 primitives |

---

## 8. Non-fonctionnel

- TypeScript strict (pas de `any`)
- `lucide-react` non installé — icônes en SVG inline (paths du prototype) dans `primitives/icons.ts`
- Captions live : 3 phrases FR hardcodées ; le `transcript:partial` du backend peut les remplacer plus tard via une prop `liveCaption?: string`
