'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal modal content to document.body so `fixed` positioning centers on
 * the viewport — never trapped by a transformed ancestor (e.g. the sidebar
 * drawer). SSR-safe: renders nothing until mounted on the client.
 */
export default function ModalShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
