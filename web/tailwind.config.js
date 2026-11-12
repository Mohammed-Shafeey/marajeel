/** Design tokens live in src/styles/tokens.css (CSS variables, light + dark). Tailwind just maps names onto them. */
const v = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v('brand'), strong: v('brand-strong'), soft: v('brand-soft'), text: v('brand-text') },
        'on-brand': v('on-brand'),
        cyan: { DEFAULT: v('cyan'), text: v('cyan-text') },
        'on-cyan': v('on-cyan'),
        volt: v('volt'),
        'on-volt': v('on-volt'),
        ink: v('ink'),
        'on-ink': v('on-ink'),
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        line: { DEFAULT: v('border'), strong: v('border-strong') },
        fg: { DEFAULT: v('text'), 2: v('text-2'), 3: v('text-3') },
        focus: v('focus'),
        win: { DEFAULT: v('win'), bg: v('win-bg') },
        loss: { DEFAULT: v('loss'), bg: v('loss-bg') },
        warn: { DEFAULT: v('warn'), bg: v('warn-bg') },
        info: { DEFAULT: v('info'), bg: v('info-bg') },
        'team-a': { DEFAULT: v('team-a'), soft: v('team-a-soft'), line: v('team-a-line'), on: v('on-team-a') },
        'team-b': { DEFAULT: v('team-b'), soft: v('team-b-soft'), line: v('team-b-line'), on: v('on-team-b') },
        'team-c': { DEFAULT: v('team-c'), soft: v('team-c-soft'), line: v('team-c-line'), on: v('on-team-c') },
        'team-d': { DEFAULT: v('team-d'), soft: v('team-d-soft'), line: v('team-d-line'), on: v('on-team-d') },
      },
      fontFamily: {
        display: v('font-display').split(','),
        num: v('font-num').split(','),
        ui: v('font-ui').split(','),
      },
      fontSize: {
        hero: ['var(--fs-hero)', { lineHeight: 'var(--lh-hero)' }],
        display: ['var(--fs-display)', { lineHeight: 'var(--lh-display)' }],
        h1: ['var(--fs-h1)', { lineHeight: 'var(--lh-h1)' }],
        h2: ['var(--fs-h2)', { lineHeight: 'var(--lh-h2)' }],
        h3: ['var(--fs-h3)', { lineHeight: 'var(--lh-h3)' }],
        body: ['var(--fs-body)', { lineHeight: 'var(--lh-body)' }],
        small: ['var(--fs-small)', { lineHeight: 'var(--lh-small)' }],
        caption: ['var(--fs-caption)', { lineHeight: 'var(--lh-caption)' }],
      },
      borderRadius: { xs: 'var(--r-xs)', sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
      boxShadow: { e1: 'var(--e-1)', e2: 'var(--e-2)', e3: 'var(--e-3)', pop: 'var(--e-pop)' },
      minHeight: { tap: 'var(--tap-min)' },
      minWidth: { tap: 'var(--tap-min)' },
      transitionTimingFunction: { standard: 'var(--ease-standard)', settle: 'var(--ease-settle)' },
    },
  },
  plugins: [],
};
