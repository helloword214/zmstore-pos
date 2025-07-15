// app/lib/theme.ts

export const theme = {
  colors: {
    primary: "bg-primary",
    primaryText: "text-primary",
    primaryHover: "hover:bg-primary-dark",

    accent: "bg-accent",
    accentText: "text-accent",
    accentHover: "hover:bg-accent-dark",

    surface: "bg-surface",
    surfaceSubtle: "bg-surface-subtle",
    surfaceStrong: "bg-surface-strong",

    gradient:
      "bg-gradient-to-br from-brandBg-gradientStart via-brandBg-gradientMid to-brandBg-gradientEnd",
  },

  text: {
    heading: "font-heading",
    base: "font-sans text-gray-800",
    muted: "text-gray-500",
  },

  buttons: {
    primary:
      "bg-primary text-white hover:bg-primary-dark font-medium px-4 py-2 rounded transition",
    accent:
      "bg-accent text-white hover:bg-accent-dark font-medium px-4 py-2 rounded transition",
    danger:
      "bg-red-600 text-white hover:bg-red-700 font-medium px-4 py-2 rounded transition",
    ghost:
      "bg-white border text-gray-700 hover:bg-gray-100 font-medium px-4 py-2 rounded",
  },

  shadow: {
    soft: "shadow-soft",
    card: "shadow-card",
  },

  radius: {
    card: "rounded-card",
    xl: "rounded-xl",
    full: "rounded-full",
  },
};
