/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        surface: {
          0: "#0a0a0f",
          1: "#12121a",
          2: "#1a1a25",
          3: "#242432",
        },
        accent: {
          DEFAULT: "#6c5ce7",
          light: "#a29bfe",
          dim: "#4834d4",
        },
        success: "#00b894",
        warning: "#fdcb6e",
        danger: "#e17055",
      },
    },
  },
  plugins: [],
};
