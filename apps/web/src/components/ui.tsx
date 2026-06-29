// VoxHelp overlay — UI primitives
import { useState, useRef } from "react";
import type { Insight } from "@voxhelp/shared";

// ---------------------------------------------------------------------------
// Icon paths
// ---------------------------------------------------------------------------
const VH_ICONS: Record<string, string> = {
  translate: "M4 5h7M7.5 5v-2M9 5s-.5 5-4 7M5 9c0 2 2.5 3.5 4.5 4M13 19l3.5-8 3.5 8M14 16h5",
  sparkle:
    "M12 3l1.6 5L18 9.6 13.6 11 12 16l-1.6-5L6 9.6 10.4 8zM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z",
  strength: "M13 2 4.5 13H11l-1 9 8.5-11H12z",
  risk: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  level: "M5 20V10M12 20V4M19 20v-7",
  chat: "M21 12a8 8 0 0 1-8 8H7l-4 3v-4.5A8 8 0 1 1 21 12z",
  mic: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10a7 7 0 0 1-14 0M12 17v4",
  copy: "M9 9h10v10H9zM5 15H4V4h11v1",
  pin: "M9 3h6l-1 6 3 3v2h-5v5l-1 2-1-2v-5H4v-2l3-3z",
  x: "M6 6l12 12M18 6 6 18",
  stop: "M6 6h12v12H6z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v4h-4",
  check: "M20 6 9 17l-5-5",
  dot: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
};

// ---------------------------------------------------------------------------
// VIcon
// ---------------------------------------------------------------------------
interface VIconProps {
  name: string;
  size?: number;
  sw?: number;
  fill?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function VIcon({ name, size = 16, sw = 1.7, fill = false, style, className }: VIconProps) {
  const d = VH_ICONS[name] ?? VH_ICONS["dot"];
  const segments = d.split("M").filter(Boolean);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "0 0 auto", ...style }}
      className={className}
      aria-hidden="true"
    >
      {segments.map((seg, i) => (
        <path key={i} d={"M" + seg} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// VHMark — logo mark (waveform glyph in a rounded square)
// ---------------------------------------------------------------------------
interface VHMarkProps {
  size?: number;
  glow?: boolean;
}

export function VHMark({ size = 30, glow = false }: VHMarkProps) {
  const heights = [0.36, 0.62, 1, 0.5];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        flex: "0 0 auto",
        background: "linear-gradient(150deg, var(--indigo), var(--violet))",
        display: "grid",
        placeItems: "center",
        position: "relative",
        boxShadow: glow
          ? "0 0 0 1px hsl(0 0% 100% / 0.18) inset, 0 6px 18px -4px var(--accent)"
          : "0 0 0 1px hsl(0 0% 100% / 0.18) inset",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: size * 0.066 }}>
        {heights.map((h, i) => (
          <span
            key={i}
            style={{
              width: size * 0.082,
              height: size * 0.52 * h,
              borderRadius: 99,
              background: "white",
              transformOrigin: "center",
              animation: glow ? `vh-bar ${0.8 + i * 0.14}s ease-in-out ${i * 0.1}s infinite` : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveWave — animated audio waveform bars
// ---------------------------------------------------------------------------
interface LiveWaveProps {
  active?: boolean;
  bars?: number;
  h?: number;
  color?: string;
  w?: number;
}

export function LiveWave({ active = true, bars = 22, h = 16, color = "currentColor", w = 2 }: LiveWaveProps) {
  const seeds = useRef(
    Array.from({ length: bars }, (_, i) => 0.25 + (Math.sin(i * 2.3) * 0.5 + 0.5) * 0.75)
  ).current;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: h }}>
      {seeds.map((s, i) => (
        <span
          key={i}
          style={{
            width: w,
            height: Math.max(3, s * h),
            borderRadius: 99,
            background: color,
            flex: "0 0 auto",
            transformOrigin: "center",
            animation: active
              ? `vh-bar ${0.6 + (i % 4) * 0.13}s ease-in-out ${i * 0.045}s infinite`
              : "none",
            opacity: active ? 0.95 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence — 3 dots indicator
// ---------------------------------------------------------------------------
const EVIDENCE_META: Record<Insight["evidence"], { dots: number; color: string; label: string }> = {
  high: { dots: 3, color: "var(--good)", label: "Concret" },
  medium: { dots: 2, color: "var(--warn)", label: "Partiel" },
  low: { dots: 1, color: "var(--risk)", label: "Vague" },
};

interface EvidenceProps {
  level: Insight["evidence"];
  showLabel?: boolean;
}

export function Confidence({ level, showLabel = true }: EvidenceProps) {
  const c = EVIDENCE_META[level];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: i < c.dots ? c.color : "hsl(0 0% 100% / 0.16)",
              boxShadow: i < c.dots ? `0 0 6px -1px ${c.color}` : "none",
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: c.color,
            letterSpacing: "0.01em",
          }}
        >
          {c.label}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CategoryTag — icon chip + label
// ---------------------------------------------------------------------------
const CATEGORY_META: Record<
  Insight["cat"],
  { color: string; icon: string; label: string }
> = {
  translation: { color: "indigo", icon: "translate", label: "Traduction" },
  jargon: { color: "violet", icon: "sparkle", label: "Jargon décodé" },
  strength: { color: "good", icon: "strength", label: "Point fort" },
  attention: { color: "risk", icon: "risk", label: "À creuser" },
};

interface CategoryTagProps {
  cat: Insight["cat"];
}

export function CategoryTag({ cat }: CategoryTagProps) {
  const meta = CATEGORY_META[cat];
  const colorVar = `var(--${meta.color})`;
  const softVar = `var(--${meta.color}-soft)`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          background: softVar,
          color: colorVar,
          boxShadow: `0 0 0 1px ${softVar}`,
        }}
      >
        <VIcon name={meta.icon} size={13} sw={2} />
      </span>
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: colorVar,
        }}
      >
        {meta.label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// GhostBtn — icon ghost button
// ---------------------------------------------------------------------------
interface GhostBtnProps {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  fill?: boolean;
  size?: number;
  iconSize?: number;
  style?: React.CSSProperties;
}

export function GhostBtn({ icon, label, onClick, active, fill, size = 30, iconSize = 15, style }: GhostBtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: "unset" as "unset",
        cursor: "pointer",
        width: size,
        height: size,
        borderRadius: 9,
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
        color: active ? "var(--text)" : hover ? "var(--text)" : "var(--text-3)",
        background: hover || active ? "var(--card-hi)" : "transparent",
        boxShadow: active ? "0 0 0 1px var(--stroke-2) inset" : "none",
        transition: "all 0.15s",
        ...style,
      }}
    >
      <VIcon name={icon} size={iconSize} fill={fill} />
    </button>
  );
}
