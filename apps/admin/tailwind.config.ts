import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#1B6E5A",
        "accent-soft": "#E7F2EF",
        ink: "#101418",
        "ink-muted": "#5B646E",
        surface: "#FFFFFF",
        "surface-subtle": "#F6F7F8",
        line: "#E3E6E9",
        danger: "#A62B2B",
        warning: "#9A6A00",
      },
    },
  },
  plugins: [],
} satisfies Config;
