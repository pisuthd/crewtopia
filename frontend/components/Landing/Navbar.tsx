'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Menu, X } from 'lucide-react';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';

const MOBILE_LINKS: [string, string][] = [
  ['Teams', '/#team'],
  ['How it works', '/#how'],
  ['Demo', '/#demo'],
  ['Features', '/#features'],
  ['FAQ', '/#faq'],
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openProduct = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setProductOpen(true);
  };
  const scheduleCloseProduct = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setProductOpen(false), 120);
  };

  return (
    <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <Link href="/" aria-label="Back to Crewtopia home" className="flex items-center gap-2.5">
        <Hexbot color="honey" size="xs" role="pm" label="Crewtopia hexbot" />
        <span className="font-brico text-lg font-bold">{brandName()}</span>
      </Link>
      <div className="hidden items-center gap-7 text-sm text-ink md:flex">
        <div
          className="relative hidden md:inline-block"
          onMouseEnter={openProduct}
          onMouseLeave={scheduleCloseProduct}
        >
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={productOpen}
            onClick={() => setProductOpen((v) => !v)}
            onFocus={openProduct}
            onBlur={scheduleCloseProduct}
            onKeyDown={(e) => e.key === 'Escape' && setProductOpen(false)}
            className="inline-flex items-center gap-1 hover:text-navy"
          >
            Product{' '}
            <motion.span
              animate={{ rotate: productOpen ? 180 : 0 }}
              transition={{ duration: 0.16 }}
              className="inline-flex"
            >
              <ChevronDown size={14} />
            </motion.span>
          </button>
          <AnimatePresence>
            {productOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98, x: '-50%' }}
                animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
                exit={{ opacity: 0, y: 6, scale: 0.98, x: '-50%' }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute left-1/2 top-full z-50 w-96 pt-3"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? 'x' : 'menu'}
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
              className="flex"
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-x-4 top-full z-50 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl md:hidden"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial="closed"
              animate="open"
              variants={{ open: { transition: { staggerChildren: 0.03 } }, closed: {} }}
            >
              <motion.div variants={{ open: { opacity: 1, y: 0 }, closed: { opacity: 0, y: -4 } }}>
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
              </motion.div>
              {MOBILE_LINKS.map(([label, href]) => (
                <motion.div
                  key={href}
                  variants={{ open: { opacity: 1, y: 0 }, closed: { opacity: 0, y: -4 } }}
                >
                  <a
                    href={href}
                    className="block rounded-xl p-3 text-sm font-semibold text-navy transition hover:bg-mist/60"
                  >
                    {label}
                  </a>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
