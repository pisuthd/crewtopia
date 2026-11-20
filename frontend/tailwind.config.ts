import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Crewtopia palette: BNB dark + honey yellow. Token names kept stable
        // so forked Landing classes work unchanged.
        navy: '#0B0E11',
        ink: '#3A3F47',
        heroslate: '#3A3F47',
        ice: '#FEF6E0',
        cta: '#F0B90B',
        ctahover: '#D6A307',
        mist: '#FAF7EF',
        thread: '#FFFDF4',
        bamber: '#F0B90B',
        bmoss: '#7BA05B',
        blagoon: '#2BB3B1',
        bash: '#9AA3AE',
        bcoral: '#E26D5A',
        bgrape: '#8B5CF6',
      },
      fontFamily: {
        brico: ['var(--font-brico)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
