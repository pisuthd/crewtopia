'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Menu, X } from 'lucide-react';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <Link href="/" aria-label="Back to Crewtopia home" className="flex items-center gap-2.5">
        <Hexbot color="honey" size="xs" role="pm" label="Crewtopia hexbot" />
        <span className="font-brico text-lg font-bold">{brandName()}</span>
      </Link>
      <div className="hidden items-center gap-7 text-sm text-ink md:flex">
        <div className="group relative hidden md:inline-block">
          <button
            type="button"
            aria-haspopup="true"
            className="inline-flex items-center gap-1 hover:text-navy"
          >
            Product <ChevronDown size={14} />
          </button>
          <div className="invisible absolute left-1/2 top-full z-50 w-96 -translate-x-1/2 pt-3 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
            <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-xl">
              <Link
                href="/app?start=ember"
                className="grid grid-cols-[7rem_1fr] gap-4 p-5 text-left transition hover:bg-mist/60"
              >
                <span className="flex items-center gap-2">
                  <Hexbot color="honey" size="xs" role="pm" label="Ember hexbot" />
                  <p className="font-brico text-base font-bold text-navy">Ember</p>
                </span>
                <p className="leading-relaxed">
                  No AI of your own? Use Ember as your assistant to find the right team to hire.
                </p>
              </Link>
            </div>
          </div>
        </div>
        <a href="/#how" className="hidden hover:text-navy md:inline">How it works</a>
        <a href="/#demo" className="hidden hover:text-navy md:inline">Demo</a>
        <a href="/#features" className="hidden hover:text-navy md:inline">Features</a>
        <a href="/#faq" className="hidden hover:text-navy md:inline">FAQ</a>
        <Link
          href="/app"
          className="rounded-xl bg-navy px-4 py-2 font-semibold text-white"
        >
          Launch app
        </Link>
      </div>
      <div className="flex items-center gap-2 md:hidden">
        <Link
          href="/app"
          className="rounded-xl bg-navy px-3 py-2 text-sm font-semibold text-white"
        >
          Launch app
        </Link>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl border border-gray-200 p-2 text-navy"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        <div
          className="absolute inset-x-4 top-full z-50 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl md:hidden"
          onClick={() => setOpen(false)}
        >
          <Link
            href="/app?start=ember"
            className="flex items-center gap-3 rounded-xl p-3 transition hover:bg-mist/60"
          >
            <Hexbot color="honey" size="xs" role="pm" label="Ember hexbot" />
            <span>
              <span className="block font-brico text-base font-bold text-navy">Ember</span>
              <span className="block text-sm text-ink">
                No AI of your own? Use Ember to find the right team.
              </span>
            </span>
          </Link>
          {[
            ['Teams', '/#team'],
            ['How it works', '/#how'],
            ['Demo', '/#demo'],
            ['Features', '/#features'],
            ['FAQ', '/#faq'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="block rounded-xl p-3 text-sm font-semibold text-navy transition hover:bg-mist/60"
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
