'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import AppShell from '@/components/App/AppShell';

function AppPageInner() {
  const params = useSearchParams();
  const start = params.get('start');
  // ?start=ember preselects the assistant; anything else falls back to first.
  const initialId = start === 'ember' ? 'ember' : undefined;
  return <AppShell initialId={initialId} />;
}

export default function AppPage() {
  return (
    <Suspense>
      <AppPageInner />
    </Suspense>
  );
}
