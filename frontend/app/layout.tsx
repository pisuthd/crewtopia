import type { Metadata } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Sora } from 'next/font/google';
import './globals.css';

const brico = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-brico',
});

const display = Sora({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-display',
});

const jbmono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jbmono',
});

export const metadata: Metadata = {
  title: 'Crewtopia | AI Teams for the Agent Economy',
  description:
    'Prebuilt AI teams with ERC-8004 onchain identities. Hire through any compatible agent, collaborate in sandboxed environments, and pay for execution time.',
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${brico.variable} ${display.variable} ${jbmono.variable} bg-mist font-display text-navy antialiased`}>
        {children}
      </body>
    </html>
  );
}
