# Handoff : VoxHelp — Overlay copilote d'entretien IA

> **Pour Claude Code.** Ce dossier contient tout le nécessaire pour implémenter VoxHelp dans une vraie base de code. Lis ce README en entier avant de commencer — il est auto-suffisant.

---

## 1. Vue d'ensemble

**VoxHelp** est un overlay de bureau (Electron) **transparent et toujours au premier plan** qui se superpose à une visioconférence (Google Meet, Teams, Zoom). Il écoute un entretien technique en direct et **traduit en temps réel ce que dit le candidat** pour un recruteur non-technique : il décode le jargon, identifie les points forts, signale les zones à creuser et suggère des questions de relance.

L'expérience cible : VoxHelp doit ressembler à **une couche d'IA invisible posée sur la visio**, pas à une application web classique. Inspirations assumées : Cluely, Raycast, Arc, Linear, Apple Intelligence.

---

## 2. À propos des fichiers de design

⚠️ **Les fichiers de ce bundle sont des références de design réalisées en HTML/React (via Babel in-browser).** Ce sont des prototypes qui montrent l'apparence et le comportement voulus — **pas du code de production à copier tel quel.**

Ta mission : **recréer ces designs dans l'environnement cible** (idéalement **React + Tailwind + Electron**, voir §9) en suivant ses conventions, et brancher l'UI sur un vrai pipeline audio → speech-to-text → LLM. Le prototype simule le flux d'insights avec des `setTimeout` ; en production, les insights arrivent via IPC depuis le process principal Electron.

### Fichiers fournis
```
design_handoff_voxhelp_overlay/
├── README.md                              ← tu es ici
├── VoxHelp — Design System & Handoff.html ← doc visuelle : tokens, anatomie, motion, snippets
└── prototype/
    ├── VoxHelp Overlay.html   ← point d'entrée : design system CSS (tokens, wallpaper, keyframes)
    ├── overlay-data.js        ← TOUT le contenu + la forme des données (Insight, statuts, captions, UI strings FR/EN)
    ├── overlay-ui.jsx         ← primitives : icônes, logo, waveform, Confidence, CategoryTag, GhostBtn
    ├── overlay-scene.jsx      ← la visio Google Meet en arrière-plan (purement décoratif)
    ├── overlay-panel.jsx      ← PanelHeader, LiveCaption, InsightCard, CommandBar
    ├── overlay-app.jsx        ← composant racine : simulation live, application des tokens, Tweaks
    └── tweaks-panel.jsx       ← panneau de réglages du prototype (NON nécessaire en prod)
```

**Ouvre `VoxHelp Overlay.html` dans un navigateur** pour voir le design animé en conditions réelles (la simulation tourne ~15 s puis se stabilise). Le fichier `VoxHelp — Design System & Handoff.html` est la version "documentée" du design system avec swatches et anatomie ASCII.

---

## 3. Fidélité

**Haute fidélité (hifi).** Couleurs, typographie, espacements, rayons, ombres et animations sont définitifs. Recrée l'UI au pixel près en utilisant les libs de la base de code. Les valeurs exactes sont en §8.

---

## 4. Structure de l'écran

Un seul "écran" : l'**overlay**, composé de l'arrière-plan visio (que VoxHelp ne dessine PAS en prod — c'est la vraie fenêtre Meet/Teams/Zoom dessous) et du **panneau de verre flottant**.

```
┌───────────────────────────── écran ─────────────────────────────┐
│  ╭───────────── capsule flottante (centrée en haut) ──────────╮  │
│  │  ◆ VoxHelp │ ● En écoute                              ⏹    │  │
│  ╰────────────────────────────────────────────────────────────╯  │
│                                              ╭─────────────────╮ │
│   [ la vraie visio est ICI, derrière ]       │  PANNEAU VERRE  │ │
│                                              │  (380–420px)    │ │
│                                              │ ┌─────────────┐ │ │
│                                              │ │ Header      │ │ │
│                                              │ ├─────────────┤ │ │
│                                              │ │ Caption live│ │ │
│                                              │ ├─────────────┤ │ │
│                                              │ │ ANALYSE …  6│ │ │
│                                              │ │ ┌─ card ──┐ │ │ │
│                                              │ │ │ insight │ │ │ │
│                                              │ │ └─────────┘ │ │ │
│                                              │ │ ┌─ card ──┐ │ │ │
│                                              │ │ └─────────┘ │ │ │
│                                              │ ├─────────────┤ │ │
│                                              │ │ Command bar │ │ │
│                                              │ │ Footer rec  │ │ │
│                                              │ └─────────────┘ │ │
│                                              ╰─────────────────╯ │
└──────────────────────────────────────────────────────────────────┘
```

### Le panneau de verre (cœur du produit)
- **Position** : flottant, collé au bord droit (par défaut), `top: 18px; bottom: 18px; right: 18px`. Le côté (gauche/droite) est configurable.
- **Largeur** : 400px par défaut (plage 340–460px).
- **Hauteur** : pleine hauteur moins les marges (toute la hauteur de l'écran en prod).
- **Fond** : `hsl(222 28% 9% / 0.52)` + `backdrop-filter: blur(34px) saturate(170%)`. **Translucide — on doit voir la visio derrière. Jamais opaque.**
- **Rayon** : 26px. **Bordure** : `box-shadow: 0 0 0 1px hsl(0 0% 100% / 0.10) inset` (hairline) + ombre portée profonde (voir token `--shadow-panel`).
- **Layout interne** : flex column. Header / Caption / label de section : `flex: 0 0 auto`. Le feed d'insights : `flex: 1; min-height: 0; overflow-y: auto`. Command bar : `flex: 0 0 auto`.

> ⚠️ **Piège flexbox connu** : les cartes du feed doivent avoir `flex-shrink: 0` (`flex: 0 0 auto`), sinon le conteneur scrollable les écrase à quelques pixels au lieu de scroller. Bug rencontré et corrigé dans le prototype.

---

## 5. Composants (détaillés)

### 5.1 — PanelHeader (`overlay-panel.jsx`)
- Padding `13px 15px 11px`, `flex: 0 0 auto`.
- **Logo** `VHMark` 30px : carré rayon 32%, dégradé `linear-gradient(150deg, var(--indigo), var(--violet))`, 4 barres blanches (waveform) qui s'animent quand l'IA réfléchit/écoute.
- **Titre** "VoxHelp" 15.5px/700, sous-titre rôle 11.5px/500 `var(--text-3)`.
- **Pill de statut** (droite) : fond `var(--card)`, rayon 99px, contenu selon l'état :
  - `listening` → point vert qui pulse + label "En écoute".
  - `speaking` → mini-waveform animée verte + "Candidat parle".
  - `analyzing` → spinner conique (`conic-gradient` masqué en anneau, `animation: vh-spin .9s linear infinite`) + "Analyse…" en `var(--accent)`.
- Bouton "œil" `GhostBtn` pour masquer.

### 5.2 — LiveCaption (`overlay-panel.jsx`)
- Bande `var(--card)`, rayon 14px, padding `9px 12px`.
- Icône micro dans une puce 26px (vert si `speaking`).
- Label "TRANSCRIPTION EN DIRECT" 10px/700, +0.08em, uppercase.
- Phrase du candidat en *italique* 12.5px, entre guillemets, `var(--text-2)`. Réanimée à chaque changement (`vh-caption-in`).

### 5.3 — InsightCard (`overlay-panel.jsx`) — **l'atome du produit**
La carte = une "pensée d'IA" flottante. `flex: 0 0 auto`, rayon 18px, padding `13px 14px`.
- **Fond** : `var(--card)` (`#fff/.045`) → hover `var(--card-hi)` (`#fff/.075`).
- **Bordure** : `0 0 0 1px var(--stroke) inset` + `--shadow-card`. Hover : stroke renforcé + `translateY(-1px)`.
- **Rail d'accent** : barre verticale 3px à gauche, couleur de la catégorie, `inset-y: 12px`, rayon 99px, opacité .85.
- **Ligne du haut** : `CategoryTag` (puce icône + label uppercase coloré) · spacer · timestamp mono 10.5px · `Confidence` (3 points).
- **Titre** : 14.5px/600, line-height 1.32, `text-wrap: pretty`.
- **Meter de niveau** (cartes `level` uniquement) : barre de progression `linear-gradient(90deg, var(--cyan), var(--indigo))` + label ("Senior").
- **Corps** : label "CE QUE ÇA VEUT DIRE" (9.5px/700 caps) puis explication 13px/1.5 `var(--text-2)`.
- **Question de relance** (optionnelle) : sous-carte `var(--accent-soft)`, rayon 12px, label "QUESTION DE RELANCE" + texte 12.5px/500 `var(--text)`.
- **Actions au survol** (haut-droite, fade-in) : `GhostBtn` Copier (→ ✓ pendant 1.4s) et Épingler (toggle).
- **Entrée** : `animation: vh-thought-in .55s cubic-bezier(.2,.8,.2,1)` + anneau coloré `vh-glow-fade` 2.4s sur la dernière carte ajoutée.

### 5.4 — CommandBar + footer (`overlay-panel.jsx`)
- 3 pills d'action (Assister · Relances · Récap) : `flex: 1`, fond `var(--card)`, icône + label 12px/600, hover éclaircit.
- Input "Demandez à VoxHelp…" : icône sparkle accent, bouton d'envoi (accent si texte saisi).
- Footer enregistrement : point rouge qui pulse + "En cours" + timer mono · bouton "Arrêter" en `var(--risk-soft)`.

### 5.5 — Capsule (`overlay-app.jsx`)
Contrôle flottant séparé, centré en haut : logo + "VoxHelp" + séparateur + statut + bouton stop. Fond verre, `vh-float` (dérive verticale 3px). Représente le compagnon "menu-bar" macOS toujours au premier plan.

### 5.6 — Primitives (`overlay-ui.jsx`)
- `VIcon` : set d'icônes ligne (paths SVG inline). En prod, remplace par `lucide-react`.
- `LiveWave` : barres animées `vh-bar` en boucles décalées.
- `Confidence` : 3 points (remplis selon `confirmed`/`partial`/`low`) + label optionnel, couleur `good`/`warn`/`risk`.
- `CategoryTag` : puce icône colorée + label uppercase.
- `GhostBtn` : bouton icône fantôme (hover = fond `card-hi`).

---

## 6. Interactions & comportement

- **Cycle de statut** (simulé, séquence `speaking → speaking → analyzing → listening`, ~2.6s par état). En prod : piloté par le pipeline audio réel.
- **Streaming d'insights** : après chaque état `analyzing`, un nouvel insight est ajouté **en bas** du feed (~1.1s plus tard), avec auto-scroll fluide vers le bas et glow d'entrée. *(Si tu préfères newest-at-top, c'est un choix produit — voir §10.)*
- **Hover carte** : lift 1px, stroke éclairci, actions Copier/Épingler en fade-in.
- **Copier** : copie `titre + corps + relance` dans le presse-papier, l'icône passe à ✓ 1.4s.
- **Captions** : tournent à chaque passage en `speaking`.
- **Reduced motion** : toutes les animations sont neutralisées sous `@media (prefers-reduced-motion: reduce)`.

---

## 7. Gestion d'état

État minimal du composant racine :
| State | Type | Rôle |
|---|---|---|
| `feed` | `Insight[]` | liste chronologique des cartes affichées (newest en dernier) |
| `status` | `'listening' \| 'speaking' \| 'analyzing'` | état courant du copilote |
| `capIdx` | `number` | index de la caption live affichée |
| `elapsed` | `number` | secondes écoulées (timer footer) |
| `newId` | `string \| null` | id de la dernière carte ajoutée (déclenche le glow) |

En production, `feed` / `status` / `caption` sont **poussés via IPC** depuis le process principal (events `insight`, `status`, `caption`). L'UI ne fait que consumer la forme `Insight` (voir §2 de la doc HTML et `overlay-data.js`).

---

## 8. Design tokens

> Source de vérité : bloc `:root` dans `prototype/VoxHelp Overlay.html`. Recopiés ici pour autonomie.

### Couleurs — verre & surfaces
| Token | Valeur |
|---|---|
| Panel base | `hsl(222 28% 9% / 0.52)` + blur 34px saturate 170% |
| Card | `hsl(0 0% 100% / 0.045)` |
| Card hover | `hsl(0 0% 100% / 0.075)` |
| Card lift | `hsl(0 0% 100% / 0.10)` |
| Stroke | `hsl(0 0% 100% / 0.10)` |
| Stroke fort | `hsl(0 0% 100% / 0.16)` |
| Texte 1 / 2 / 3 | `#fff/.95` · `#fff/.62` · `#fff/.40` |

### Couleurs — accent & catégories (oklch, même famille chroma/lightness)
| Token | Valeur | Usage |
|---|---|---|
| `--accent` / `--indigo` | `oklch(0.70 0.14 268)` | accent, catégorie Traduction |
| `--violet` | `oklch(0.70 0.16 300)` | Jargon décodé |
| `--cyan` | `oklch(0.75 0.12 212)` | Niveau technique |
| `--good` | `oklch(0.76 0.15 158)` | Point fort / Confirmé |
| `--warn` | `oklch(0.81 0.13 80)` | Partiel |
| `--risk` | `oklch(0.72 0.16 25)` | À creuser / Stop |

Les variantes `-soft` = même teinte à **16% d'alpha**.

### Variantes de teinte du verre (configurable)
- `graphite` (défaut) : `--glass-tint: 222 10% 9%`
- `indigo` : `248 40% 12%`
- `frost` : `220 18% 16%`, alpha `0.46`

### Typo
- **Onest** (400/500/600/700) pour toute l'UI — Google Fonts.
- **JetBrains Mono** (400/500/600) pour timers, compteurs, timestamps.
- Échelle : Titre 14.5/600 · Corps 13/400 lh1.5 · Label 10/700 +0.09em uppercase · Titre header 15.5/700.

### Rayons · Ombres · Blur
- Rayons : panneau **26** · carte **18** · puces **7–12** · pills **99**.
- `--shadow-panel`: `0 1px 0 hsl(0 0% 100% / .08) inset, 0 24px 70px -12px hsl(230 40% 4% / .7), 0 8px 28px -8px hsl(230 40% 4% / .55)`
- `--shadow-card`: `0 1px 0 hsl(0 0% 100% / .06) inset, 0 8px 24px -10px hsl(230 40% 4% / .5)`
- Blur : **34px** par défaut (plage 12–60).

### Keyframes (voir `<style>` du HTML)
`vh-thought-in` (entrée carte) · `vh-glow-fade` (anneau) · `vh-shimmer` (bordure "analyse") · `vh-bar` (waveform) · `vh-spin` (spinner) · `vh-pulse` · `vh-float` (capsule) · `vh-caption-in`. Easing standard : `cubic-bezier(.2,.8,.2,1)`, durées < 600ms.

---

## 9. Intégration Electron

Fenêtre `BrowserWindow` sans cadre, transparente, toujours au premier plan, dockée à droite. Détails complets + snippet dans **`VoxHelp — Design System & Handoff.html` (section 06)**. Points clés :
- `frame: false`, `transparent: true`, `hasShadow: false`, `alwaysOnTop: true`, `resizable: false`, `skipTaskbar: true`, `vibrancy: 'under-window'` (macOS).
- `overlay.setAlwaysOnTop(true, 'screen-saver')` pour flotter au-dessus des visios plein écran.
- **Click-through** : `setIgnoreMouseEvents(true, { forward: true })` sur les zones vides, réactivé au survol des zones interactives via IPC.
- **Confidentialité** : `setContentProtection(true)` pour exclure l'overlay du partage d'écran / enregistrement.
- **Audio** : capture via `desktopCapturer` (ou device audio virtuel) → STT → LLM → push d'objets `Insight` au renderer via IPC.

---

## 10. React + Tailwind

Snippets complets (`tailwind.config.js`, type `Insight`, `InsightCard.tsx`) dans **`VoxHelp — Design System & Handoff.html` (section 07)**.

**Stack recommandée** : React 18 · Tailwind 3.4+ (support `oklch` / alpha arbitraire) · **framer-motion** pour l'entrée des cartes et le layout (`AnimatePresence` sur le feed) · `clsx`/`cn` pour les variantes · `lucide-react` pour les icônes.

**Forme des données** (depuis `overlay-data.js`) :
```ts
type Insight = {
  id: string;
  cat: 'translation' | 'jargon' | 'strength' | 'risk' | 'level';
  confidence: 'confirmed' | 'partial' | 'low';
  t: string;            // '07:31' — horodatage dans l'appel
  title: string;        // le titre de l'insight
  body: string;         // explication en langage clair ("ce que ça veut dire")
  relance?: string;     // question de relance suggérée (optionnel)
  level?: number;       // 0–1, uniquement pour cat: 'level'
};
```
> Dans le prototype, `title`/`body`/`relance` sont des objets `{ fr, en }` pour le toggle de langue. En prod, garde une seule langue par insight (résolue côté serveur) ou conserve le pattern i18n si tu veux le bilingue.

### Décisions produit ouvertes (à confirmer avec le designer/PO)
- **Ordre des cartes** : actuellement newest-en-bas + auto-scroll. Alternative : newest-en-haut (souvent préféré pour un flux d'IA).
- **Vidéo réelle** du candidat : le prototype dessine une tuile Meet décorative ; en prod la vraie visio est dessous (overlay transparent).
- **Panneau Tweaks** (`tweaks-panel.jsx`) : outil de prototypage uniquement — **ne pas porter** en prod. Les options utiles (teinte, largeur, côté, langue) deviennent des préférences utilisateur.

---

## 11. Assets

- **Polices** : Onest + JetBrains Mono via Google Fonts (`<link>` dans le HTML). En prod : `next/font` ou self-host.
- **Icônes** : SVG inline dans `overlay-ui.jsx` → remplacer par `lucide-react` (équivalents : translate, sparkles, zap, alert-triangle, bar-chart, mic, message-circle…).
- **Logo VoxHelp** : généré en CSS (`VHMark`) — carré dégradé + barres waveform. Pas de fichier image ; reproductible en composant.
- **Aucune image bitmap** n'est requise.
```
