/**
 * Insurance Autopilot design tokens.
 * One restrained accent colour, neutral surfaces, accessible contrast.
 */
export const colors = {
  accent: "#1B6E5A",
  accentSoft: "#E7F2EF",
  ink: "#101418",
  inkMuted: "#5B646E",
  surface: "#FFFFFF",
  surfaceSubtle: "#F6F7F8",
  border: "#E3E6E9",
  success: "#1B6E5A",
  warning: "#9A6A00",
  danger: "#A62B2B",
  info: "#2B5FA6",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  fontFamily: "System",
  sizes: {
    caption: 13,
    body: 16,
    subtitle: 18,
    title: 24,
    display: 32,
  },
  weights: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

export const DISPLAY_TIMEZONE = "America/Edmonton";

export const MVP_DISCLAIMER =
  "Insurance Autopilot is currently a demonstration and workflow platform. Quotes, recommendations and switch statuses in this environment are simulated and do not constitute insurance advice, binding coverage or brokerage services.";
