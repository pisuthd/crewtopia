'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import AppShell from '@/components/App/AppShell';
import { WalletProvider } from '@/components/App/WalletContext';
import { SessionProvider } from '@/components/App/SessionContext';

function AppPageInner() {
  const params = useSearchParams();
  const start = params.get('start');
  // ?start=ember preselects the assistant; anything else opens unselected.
  const initialId = start === 'ember' ? 'ember' : undefined;
  return <AppShell initialId={initialId} />;
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
