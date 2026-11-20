'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Fingerprint, LogOut, Pencil, Search, Sparkles, Users, Wallet } from 'lucide-react';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';
import type { MockBot } from './mockTeam';
import { useSession } from './SessionContext';
import { useWallet } from './WalletContext';
import WalletModal from './WalletModal';
import AssistantModal from './AssistantModal';
import ConnectorsModal from './ConnectorsModal';
import { truncateAddress } from '@/lib/wallet';
import { AnimatePresence, motion } from 'framer-motion';

interface SidebarProps {
  assistant: MockBot[];
  team: { name: string; members: MockBot[] };
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  showSearch: boolean;
  onToggleSearch: () => void;
  open: boolean;
  onClose: () => void;
  promptAssistant?: boolean;
}

function Section({
  title,
  bots,
  startIndex,
  selectedId,
  onSelect,
}: {
  title: string | null;
  bots: MockBot[];
  startIndex: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (bots.length === 0) return null;
  return (
    <section>
      {title && (
        <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-wfink/70">
          {title} · {bots.length}
        </p>
      )}
      <div className="space-y-1">
        {bots.map((b, i) => {
          const selected = b.id === selectedId;
          return (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
                selected ? 'bg-white shadow-sm' : 'hover:bg-white/60'
              }`}
            >
              <Hexbot
                color={b.color}
                size="sm"
                role={b.hexRole}
                blinkDelay={`-${(startIndex + i) * 1.4}s`}
                label={`${b.name} hexbot`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold text-wfnavy">
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="block truncate text-sm text-wfink">{b.role}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function Sidebar({
  assistant,
  team,
  selectedId,
  onSelect,
  query,
  onQuery,
  showSearch,
  onToggleSearch,
  open,
  onClose,
  promptAssistant,
}: SidebarProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const dismissed = useRef(false);
  const { profile, ready } = useSession();
  const emberAssigned = profile?.assistantId === 'ember';

  // ?start=ember with no assignment → prompt the picker once the database
  // answer is in. Never before (no flashing), never after dismiss.
  useEffect(() => {
    if (promptAssistant && ready && !emberAssigned && !dismissed.current) {
      setAssistantOpen(true);
    }
  }, [promptAssistant, ready, emberAssigned]);
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-20 bg-wfnavy/40 md:hidden ${open ? '' : 'hidden'}`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[19rem] flex-col border-r border-wfnavy/10 bg-wfice transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Link href="/" aria-label="Back to Crewtopia home" className="flex shrink-0 items-center gap-2.5 rounded-lg">
            <Hexbot color="honey" size="xs" role="pm" blinkDelay="-0.7s" label="Crewtopia hexbot" />
            <span className="font-brico text-lg font-bold text-wfnavy">{brandName()}</span>
          </Link>
          <div className="flex gap-2">
            <button
              onClick={onToggleSearch}
              aria-label="Search team"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="Start a team"
              title="Coming soon"
              className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-full bg-white text-wfnavy/40 shadow-sm"
            >
              <Users className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="px-4 pb-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search my team…"
              className="w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
            />
          </div>
        )}

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-1" aria-label="My team">
          {emberAssigned ? (
            <Section title={null} bots={assistant} startIndex={0} selectedId={selectedId} onSelect={onSelect} />
          ) : (
            <button
              onClick={() => ready && setAssistantOpen(true)}
              disabled={!ready}
              className={`flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-wfnavy/20 p-3 text-left transition hover:border-wfcta/60 hover:bg-white/60 disabled:cursor-wait ${
                !ready ? 'animate-pulse' : ''
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white shadow-sm">
                <Sparkles className="h-5 w-5 text-wfcta" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-wfnavy">Choose your AI assistant</span>
                <span className="block truncate text-sm text-wfink">1 assistant available</span>
              </span>
            </button>
          )}
          <Section title={team.name} bots={team.members} startIndex={assistant.length} selectedId={selectedId} onSelect={onSelect} />
          {assistant.length === 0 && team.members.length === 0 && emberAssigned && (
            <p className="px-3 py-4 text-sm text-wfink">No matches.</p>
          )}
        </nav>

        <div className="border-t border-wfnavy/10 p-4">
          <ProfileName />
          <WalletFooter onOpen={() => setModalOpen(true)} />
        </div>
      </aside>
      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AssistantModal
        open={assistantOpen}
        onClose={() => {
          dismissed.current = true;
          setAssistantOpen(false);
        }}
      />
    </>
  );
}

function ProfileName() {
  const { address, isConnected } = useWallet();
  const { profile, signedIn, rename } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isConnected || !address) return null;
  const label = signedIn ? (profile?.displayName ?? truncateAddress(address)) : truncateAddress(address);

  const save = async () => {
    const v = draft.trim();
    setEditing(false);
    if (!v || v === profile?.displayName) return;
    setSaving(true);
    try {
      await rename(v);
    } catch {
      // keep old name on failure; error surfaces on next sign-in attempt
    } finally {
      setSaving(false);
    }
  };

  return (
    <p className="mb-2 flex items-center gap-1.5 text-sm text-wfink">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
          maxLength={40}
          placeholder="Enter your name"
          className="w-full rounded-lg border border-wfnavy/15 bg-white px-2 py-1 text-sm text-wfnavy outline-none focus:border-wfcta"
        />
      ) : (
        <>
          <span className="truncate" title={signedIn ? address : undefined}>
            {saving ? 'Saving…' : label}
          </span>
          {signedIn && (
            <button
              onClick={() => {
                setDraft(profile?.displayName ?? '');
                setEditing(true);
              }}
              aria-label="Set display name"
              className="shrink-0 hover:text-wfnavy"
            >
              <Pencil className="h-3 w-3" strokeWidth={2} />
            </button>
          )}
        </>
      )}
    </p>
  );
}

function WalletFooter({ onOpen }: { onOpen: () => void }) {
  const { address, isConnected, isCorrectChain, disconnect, switchNetwork, balance } = useWallet();
  const { signedIn, signingIn, signIn, signOut, profile } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90"
      >
        <Wallet className="h-4 w-4" strokeWidth={2.2} />
        Connect wallet
      </button>
    );
  }

  if (!isCorrectChain) {
    return (
      <button
        type="button"
        onClick={() => switchNetwork().catch(() => {})}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-bamber py-2.5 text-sm font-bold text-wfnavy hover:opacity-90"
      >
        <Wallet className="h-4 w-4" strokeWidth={2.2} />
        Switch to BNB Testnet
      </button>
    );
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {}
  };

  const initial = (
    signedIn && profile?.displayName ? profile.displayName.charAt(0) : address.charAt(2)
  ).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            role="menu"
            aria-label="Wallet menu"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1 w-52 overflow-hidden rounded-2xl border border-wfnavy/10 bg-white py-1.5 shadow-xl shadow-wfnavy/10"
          >
            <div className="px-4 pb-2 pt-1.5">
              <span className="block truncate font-mono text-sm font-bold text-wfnavy" title={address}>
                {truncateAddress(address)}
              </span>
              <span className="block text-xs text-wfink">
                {balance !== null ? `${balance} tBNB` : '…'} · BNB Testnet
              </span>
            </div>
            <div className="mx-4 my-1 border-t border-wfnavy/10" aria-hidden="true" />
            <button
              role="menuitem"
              onClick={() => void copyAddress()}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-wfnavy hover:bg-wfice"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" strokeWidth={2.2} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={2.2} />
              )}
              {copied ? 'Copied!' : 'Copy address'}
            </button>
            <div className="mx-4 my-1 border-t border-wfnavy/10" aria-hidden="true" />
            {!signedIn && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void signIn().catch(() => {});
                }}
                disabled={signingIn}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-wfnavy hover:bg-wfice disabled:opacity-50"
              >
                <Fingerprint className="h-4 w-4" strokeWidth={2.2} />
                {signingIn ? 'Check your wallet…' : 'Sign in'}
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                signOut();
                disconnect();
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-wfnavy hover:bg-wfice"
            >
              <LogOut className="h-4 w-4" strokeWidth={2.2} />
              Disconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Wallet menu"
          title={address}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white font-bold text-wfnavy shadow-sm hover:bg-slate-50"
        >
          {initial}
        </button>
        <button
          onClick={() => setConnectorsOpen(true)}
          className="flex flex-1 items-center justify-center gap-2.5 rounded-full bg-white py-2.5 font-semibold text-wfnavy shadow-sm hover:bg-slate-50"
        >
          Connectors
          <span className="flex -space-x-1.5" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/stripe.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/hubspot.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/mailchimp.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
          </span>
        </button>
      </div>
      <ConnectorsModal open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
    </div>
  );
}
