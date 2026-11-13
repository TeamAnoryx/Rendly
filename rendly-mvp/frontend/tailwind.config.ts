import type { Config } from 'tailwindcss';

/**
 * Rendly monochrome design system (Linear-grade).
 * Canvas is near-black; elevation is expressed with grey steps and hairline white-alpha borders.
 * Colour is reserved for accents: the spectrum gradient, status dots and destructive actions.
 * Source of truth for values: styles/rendly-theme.css (CSS variables). Keep the two in sync.
 */

// One neutral ramp, reused for every legacy palette name so older class names stay monochrome.
const neutral = {
  DEFAULT: '#8a8f98',
  50: '#f7f8f8',
  100: '#e6e7e9',
  200: '#d0d3d8',
  300: '#b4b8bf',
  400: '#8a8f98',
  500: '#62666d',
  600: '#3e4045',
  700: '#26272b',
  800: '#17181a',
  900: '#0f1011',
  950: '#08090a',
};

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'media',
  theme: {
    screens: {
      xs: '380px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',

      gray: neutral,
      neutral,

      // Legacy palette names → monochrome.
      space_indigo: neutral,
      dusty_grape: neutral,
      pale_sky_1: neutral,
      pale_sky_2: neutral,
      white_1: { ...neutral, DEFAULT: '#f7f8f8' },
      ink_black: { ...neutral, DEFAULT: '#08090a' },
      glaucous: neutral,
      powder_blue: neutral,
      alabaster_grey: neutral,

      // Semantic tokens (mirror rendly-theme.css)
      background: '#08090a',
      foreground: '#f7f8f8',
      primary: '#f7f8f8',
      secondary: '#d0d6e0',
      accent: '#f7f8f8',
      muted: '#1a1b1d',
      'muted-foreground': '#8a8f98',
      border: 'rgba(255, 255, 255, 0.08)',
      'input-bg': '#0f1011',
      'card-bg': '#0f1011',
      error: '#eb5757',
      success: '#4cc38a',
      warning: '#f2c94c',
      info: '#5e9eff',
      red: { 400: '#f87171', 500: '#eb5757', 600: '#dc2626', 700: '#b91c1c' },
      green: { 400: '#4ade80', 500: '#4cc38a', 600: '#16a34a' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        chillax: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      backgroundColor: {
        primary: '#0f1011',
        secondary: '#141516',
        tertiary: '#1a1b1d',
        accent: '#f7f8f8',
        dark: '#08090a',
      },
      textColor: {
        primary: '#f7f8f8',
        secondary: '#d0d6e0',
        tertiary: '#8a8f98',
        muted: '#62666d',
        accent: '#f7f8f8',
      },
      borderColor: {
        primary: 'rgba(255, 255, 255, 0.08)',
        secondary: 'rgba(255, 255, 255, 0.12)',
        accent: 'rgba(255, 255, 255, 0.24)',
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        'sm-light': '0 1px 2px rgba(0, 0, 0, 0.4)',
        'md-light': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'lg-light': '0 12px 32px rgba(0, 0, 0, 0.5)',
        'xl-light': '0 24px 64px rgba(0, 0, 0, 0.6)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(180deg, #f7f8f8 0%, #b4b8bf 100%)',
        'gradient-accent': 'var(--rd-spectrum)',
        'gradient-light': 'none',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
