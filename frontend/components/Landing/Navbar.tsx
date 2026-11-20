'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';

export default function Navbar() {
  const router = useRouter();
  return (
    <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <Link href="/" aria-label="Back to Crewtopia home" className="flex items-center gap-2.5">
        <Hexbot color="honey" size="xs" role="pm" label="Crewtopia hexbot" />
        <span className="font-brico text-lg font-bold">{brandName()}</span>
      </Link>
      <div className="flex items-center gap-7 text-sm text-ink">
        <a href="/#team" className="hidden hover:text-navy md:inline">Teams</a>
        <a href="/#how" className="hidden hover:text-navy md:inline">How it works</a>
        <a href="/#demo" className="hidden hover:text-navy md:inline">Demo</a>
        <a href="/#features" className="hidden hover:text-navy md:inline">Features</a>
        <a href="/#faq" className="hidden hover:text-navy md:inline">FAQ</a>
        <button
          type="button"
          onClick={() => router.push('/app')}
          className="rounded-xl bg-navy px-4 py-2 font-semibold text-white"
        >
          Launch app
        </button>
      </div>
    </nav>
  );
}
