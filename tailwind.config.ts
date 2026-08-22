import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral, calm palette — this UI sits beside a live meeting.
        ink: "#0f1729",
        panel: "#151d33",
        edge: "#26324f",
        accent: "#6ea8fe",
        muted: "#8a97b5",
      },
    },
  },
  plugins: [],
};

export default config;
