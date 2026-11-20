import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

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
        // Wayfind app palette (scoped wf* so the landing keeps BNB tones).
        // Used only by /app (cloned from wayfind-swarm).
        wfnavy: '#0E1B2C',
        wfink: '#38506B',
        wfice: '#E9F1FA',
        wfcta: '#2F7BFF',
        wfctahover: '#1F63DA',
        wfmist: '#F4F7FB',
        wfthread: '#F7FAFD',
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
  plugins: [typography],
};

export default config;
