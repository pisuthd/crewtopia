'use client';

import Navbar from '@/components/Landing/Navbar';
import Explorer from '@/components/Landing/Explorer';
import Footer from '@/components/Landing/Footer';

export default function ExplorerPage() {
  return (
    <main className="bg-white text-navy">
      <Navbar />
      <Explorer />
      <Footer />
    </main>
  );
}
