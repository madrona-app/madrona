/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Madrona "modern gallery" palette.
        // Single source of truth = the :root CSS vars in src/index.css; these
        // tokens only reference them. RGB-channel vars + <alpha-value> keep
        // opacity modifiers (e.g. bg-semantic-error/10) working. Never hardcode
        // a hex in a component — add/extend a token here instead.

        // Neutrals (70% of UI)
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        parchment: 'rgb(var(--color-parchment) / <alpha-value>)',
        'parchment-warm': 'rgb(var(--color-parchment-warm) / <alpha-value>)',
        lichen: 'rgb(var(--color-lichen) / <alpha-value>)',
        stone: 'rgb(var(--color-stone) / <alpha-value>)',
        archive: 'rgb(var(--color-archive) / <alpha-value>)',
        moss: 'rgb(var(--color-moss) / <alpha-value>)',

        // Structural
        forest: 'rgb(var(--color-forest) / <alpha-value>)',

        // Primary emphasis
        bark: 'rgb(var(--color-bark) / <alpha-value>)',

        // Cool accent — informational / selected / active (#14)
        azurite: {
          DEFAULT: 'rgb(var(--color-azurite) / <alpha-value>)',
          deep: 'rgb(var(--color-azurite-deep) / <alpha-value>)',
        },

        // AI / Guide Studio accent (forest-sidebar only)
        studio: 'rgb(var(--color-studio) / <alpha-value>)',

        // Warm accent (hover)
        copper: {
          DEFAULT: 'rgb(var(--color-copper) / <alpha-value>)',
          light: 'rgb(var(--color-copper-light) / <alpha-value>)',
          dark: 'rgb(var(--color-copper-dark) / <alpha-value>)',
        },

        // High-contrast gray (≥7:1)
        'accessible-gray': 'rgb(var(--color-accessible-gray) / <alpha-value>)',

        // Semantic
        semantic: {
          success: 'rgb(var(--color-success) / <alpha-value>)',
          warning: 'rgb(var(--color-warning) / <alpha-value>)',
          error: 'rgb(var(--color-error) / <alpha-value>)',
          info: 'rgb(var(--color-info) / <alpha-value>)',
        },

        // Visualization palette (1/2/4 reuse info/success/warning)
        viz: {
          1: 'rgb(var(--color-info) / <alpha-value>)',
          2: 'rgb(var(--color-success) / <alpha-value>)',
          3: 'rgb(var(--color-viz-3) / <alpha-value>)',
          4: 'rgb(var(--color-warning) / <alpha-value>)',
          5: 'rgb(var(--color-viz-5) / <alpha-value>)',
          6: 'rgb(var(--color-viz-6) / <alpha-value>)',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Guide Studio brand: Cormorant Garamond is the display/wordmark face
        // (roman = Studio/production, italic = Guide/voice). IBM Plex Mono
        // carries technical metadata (agent counts, draft IDs).
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      spacing: {
        // Archival-inspired spacing
        'archival-xs': '0.5rem',
        'archival-sm': '1rem',
        'archival-md': '1.5rem',
        'archival-lg': '2rem',
        'archival-xl': '3rem',
      },
      borderRadius: {
        'institutional': '0.125rem', // Minimal rounding
      },
      boxShadow: {
        'archival': '0 1px 3px 0 rgba(28, 28, 28, 0.08)',
        'archival-md': '0 2px 6px 0 rgba(28, 28, 28, 0.1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms')({ strategy: 'class' }),
  ],
}
