'use client';

import Landing from '@/components/Landing';

export default function Home() {
  const scrollToTeam = () => {
    document.getElementById('team')?.scrollIntoView({ behavior: 'smooth' });
  };
  return <Landing onSignIn={scrollToTeam} />;
}
