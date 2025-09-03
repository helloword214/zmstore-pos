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
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    accent: "bg-slate-900 text-white hover:bg-slate-800",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
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
