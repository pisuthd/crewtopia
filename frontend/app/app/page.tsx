'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import AppShell from '@/components/App/AppShell';
import { WalletProvider } from '@/components/App/WalletContext';
import { SessionProvider } from '@/components/App/SessionContext';

function AppPageInner() {
  const params = useSearchParams();
  const start = params.get('start');
  // ?start=ember preselects the assistant only if the database confirms
  // the assignment — otherwise the picker modal is prompted instead.
  const initialId = start === 'ember' ? 'ember' : undefined;
  const promptAssistant = start === 'ember';
  const promptTokens = start === 'request-tokens';
  return <AppShell initialId={initialId} promptAssistant={promptAssistant} promptTokens={promptTokens} />;
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
