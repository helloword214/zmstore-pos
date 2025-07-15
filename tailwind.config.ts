import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 🎨 Core Brand Colors
        primary: {
          DEFAULT: "#2563eb", // blue-600
          light: "#3b82f6", // blue-500
          dark: "#1e40af", // blue-800
        },
        accent: {
          DEFAULT: "#f97316", // orange-500
          light: "#fb923c", // orange-400
          dark: "#c2410c", // orange-700
        },
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#f9fafb", // gray-50
          strong: "#f3f4f6", // gray-100
        },
        brandBg: {
          gradientStart: "#fef3c7", // warm yellow
          gradientMid: "#ffffff",
          gradientEnd: "#eff6ff", // soft blue
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        heading: ["Poppins", "Inter", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      spacing: {
        "128": "32rem",
        "144": "36rem",
        header: "4.5rem", // For fixed header heights
      },
      boxShadow: {
        soft: "0 4px 12px rgba(0, 0, 0, 0.08)",
        card: "0 1px 4px rgba(0, 0, 0, 0.06)",
      },
      extend: {
        borderRadius: {
          xl: "1rem",
          "2xl": "1.25rem",
          card: "0.75rem",
        },
      },
      transitionDuration: {
        0: "0ms",
        400: "400ms",
        600: "600ms",
      },
      transitionTimingFunction: {
        "in-expo": "cubic-bezier(0.95, 0.05, 0.795, 0.035)",
        "out-expo": "cubic-bezier(0.19, 1, 0.22, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
