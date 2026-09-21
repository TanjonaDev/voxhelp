import type { SttProviderInfo } from "@voxhelp/shared";
import { Select } from "./ui.js";

interface SttProviderSelectProps {
  providers: SttProviderInfo[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
}

// The `.input` class applied by <Select> is only styled under `.cours-theme`, so in the dark
// glass header the select is styled inline, matching the level <select> of the setup form.
const OPTION_STYLE = { background: "#1a1d26" } as const;

export function SttProviderSelect({ providers, value, onChange, disabled }: SttProviderSelectProps) {
  if (providers.length === 0) return null;

  return (
    <Select
      aria-label="Modèle de transcription"
      title={disabled ? "Arrêtez la session pour changer de modèle" : "Modèle de transcription"}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "auto",
        minWidth: 150,
        height: 32,
        padding: "0 10px",
        fontSize: 12.5,
        fontFamily: "var(--font)",
        color: "var(--text)",
        background: "var(--card-hi)",
        borderRadius: 9,
        border: "none",
        boxShadow: "0 0 0 1px var(--stroke) inset",
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {providers.map((p) => (
        <option key={p.id} value={p.id} disabled={!p.available} style={OPTION_STYLE}>
          {p.available ? p.label : `${p.label} (non configuré)`}
        </option>
      ))}
    </Select>
  );
}
