'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import AppShell from '@/components/App/AppShell';
import { WalletProvider } from '@/components/App/WalletContext';
import { SessionProvider } from '@/components/App/SessionContext';

function AppPageInner() {
  const params = useSearchParams();
  const start = params.get('start');
  const promptTokens = start === 'request-tokens';
  return <AppShell promptTokens={promptTokens} />;
}

export default function AppPage() {
  return (
    <WalletProvider>
      <SessionProvider>
        <Suspense>
          <AppPageInner />
        </Suspense>
      </SessionProvider>
    </WalletProvider>
  );
}
