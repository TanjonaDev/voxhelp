/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        surface: {
          0: "#F6F7FB",
          1: "#FFFFFF",
          2: "#F6F7FB",
          3: "#DFE1EA",
        },
        accent: {
          DEFAULT: "#3D5AFE",
          light: "#7B8FFF",
          dim: "#3451e0",
        },
        success: "#0FAA6C",
        warning: "#E8850A",
        danger: "#DC3545",
      },
    },
  },
  plugins: [],
};
