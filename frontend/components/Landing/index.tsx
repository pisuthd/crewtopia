'use client';

import Navbar from './Navbar';
import Hero from './Hero';
import LivePreview from './LivePreview';
import Features from './Features';
import Teams from './Teams';
import HowItWorks from './HowItWorks';
import Pricing from './Pricing';
import Faq from './Faq';
import Footer from './Footer';

export default function Landing() {
  return (
    <main className="bg-white text-navy">
      <Navbar />
      <Hero />
      <LivePreview />
      <Features />
      <Teams />
      <HowItWorks />
      {/* <Pricing /> — hire CTA hidden for now */}
      <Faq />
      <Footer />
    </main>
  );
}
