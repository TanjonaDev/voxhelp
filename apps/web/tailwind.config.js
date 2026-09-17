/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Onest", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
        // "Arrondi" theme (design_handoff_v2_arrondi/) — transcript de
        // cours screens — kept separate from the default sans/mono used by
        // the dark Prep/Live/Report overlay.
        "cours-heading": ['"Barlow Condensed"', "system-ui", "sans-serif"],
        "cours-body": ["Barlow", "system-ui", "sans-serif"],
      },
      colors: {
        // v2 "Arrondi" theme tokens (design_handoff_v2_arrondi/README.md).
        cours: {
          accent: "#5980a6",
          "accent-dark": "#2c455d",
          "accent-tint": "#eef3f8",
          ink: "#1d1f20",
          "text-secondary": "#6b6a67",
          "text-tertiary": "#8a8885",
          "text-faint": "#a3a09c",
          "text-faint-2": "#b5b2ae",
          surface: "#ffffff",
          "surface-soft": "#faf9f7",
          chip: "#f2f1ee",
          "chip-2": "#f6f5f3",
          hairline: "#ecebe8",
          "field-border": "#e0dedb",
          "field-border-hover": "#cfccc7",
          "dropzone-bg": "#f7fafc",
        },
      },
      borderRadius: {
        "cours-card": "22px",
        "cours-lg": "18px",
        "cours-chapter": "12px",
        "cours-field": "11px",
        "cours-audio-row": "14px",
      },
      boxShadow: {
        "cours-card": "0 1px 2px rgba(29,31,32,0.05), 0 18px 48px -16px rgba(29,31,32,0.28)",
        "cours-tabs": "0 1px 2px rgba(29,31,32,0.06)",
        "cours-toggle-active": "0 1px 2px rgba(29,31,32,0.1)",
        "cours-btn-primary": "0 6px 18px -8px rgba(89,128,166,0.8)",
      },
    },
  },
  plugins: [],
};
