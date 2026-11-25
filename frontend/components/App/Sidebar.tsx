'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Cog, Droplets, LogIn, LogOut, Pencil, Plus, Search, Users, Wallet } from 'lucide-react';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';
import type { SidebarBot } from './crew';
import { memberMetaFor } from './crew';
import type { LiveCrew } from '@/lib/api';
import { getSandboxStatus, terminateSandbox, type SandboxStatus } from '@/lib/api';
import { useSession } from './SessionContext';
import { useWallet } from './WalletContext';
import WalletModal from './WalletModal';
import ConfirmModal from './ConfirmModal';
import SandboxPanel from './SandboxPanel';
import TokensModal from './TokensModal';
import ConnectorsModal from './ConnectorsModal';
import SettingsModal from './Settings';
import { truncateAddress } from '@/lib/wallet';
import { AnimatePresence, motion } from 'framer-motion';

interface SidebarProps {
  rentals: LiveCrew[];
  onChanged: () => void;
  onOpenTeams: (renew?: LiveCrew) => void;
  onOpenAddMember: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  showSearch: boolean;
  onToggleSearch: () => void;
  open: boolean;
  onClose: () => void;
  promptTokens?: boolean;
}

function Section({
  title,
  bots,
  startIndex,
  selectedId,
  onSelect,
  actions,
}: {
  title: string | null;
  bots: SidebarBot[];
  startIndex: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  actions?: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  if (bots.length === 0) return null;
  return (
    <section>
      {title && (
        <div className="flex items-center justify-between gap-1 px-1 pb-1">
          <p className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-wfink/70">
            {title}
          </p>
          {actions?.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              className={`shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold shadow-sm hover:bg-slate-50 ${
                a.danger ? 'text-red-600' : 'text-wfcta'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
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
  rentals,
  onChanged,
  onOpenTeams,
  onOpenAddMember,
  selectedId,
  onSelect,
  query,
  onQuery,
  showSearch,
  onToggleSearch,
  open,
  onClose,
  promptTokens,
}: SidebarProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const sandboxLoadedRef = useRef(false);
  const [endTarget, setEndTarget] = useState<LiveCrew | null>(null);
  const tokensDismissed = useRef(false);
  const { ready, signedIn, token } = useSession();

  const refreshSandbox = useCallback(async () => {
    if (!token) {
      setSandbox(null);
      sandboxLoadedRef.current = false;
      setSandboxLoading(true);
      return;
    }
    setSandbox(await getSandboxStatus(token));
    if (!sandboxLoadedRef.current) {
      sandboxLoadedRef.current = true;
      setSandboxLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshSandbox();
  }, [refreshSandbox]);

  // Tick sandbox state while signed in.
  useEffect(() => {
    if (!signedIn) return;
    const t = setInterval(() => void refreshSandbox(), 30000);
    return () => clearInterval(t);
  }, [signedIn, refreshSandbox]);

  const handleEnd = async (crew: LiveCrew): Promise<string | null> => {
    if (!token) return 'Sign in first.';
    try {
      await terminateSandbox(token, crew.taskId);
    } catch (e) {
      // ending is idempotent — refresh anyway, the list is the truth
      if (!(e instanceof Error && /already ended|unknown rental/i.test(e.message))) {
        return e instanceof Error ? e.message : 'Could not end the rental.';
      }
    }
    onChanged();
    onChanged();
    if (selectedId?.startsWith(`m:${crew.taskId}:`)) onSelect('');
    return null;
  };

  // ?start=request-tokens → open the faucet modal once. No session needed.
  useEffect(() => {
    if (promptTokens && !tokensDismissed.current) {
      setTokensOpen(true);
    }
  }, [promptTokens]);
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
              onClick={onOpenAddMember}
              disabled={!rentals.some((r) => r.status === 'working')}
              aria-label="Add a team member"
              title={
                rentals.some((r) => r.status === 'working')
                  ? 'Add a member to the live crew'
                  : 'Hire a team first — members can only join a live crew'
              }
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              onClick={() => (signedIn ? onOpenTeams() : setModalOpen(true))}
              aria-label="Hire a team"
              title="Hire a team"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
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

        <nav className="flex flex-1 flex-col space-y-3 overflow-y-auto px-3 py-1" aria-label="My team">
          {signedIn &&
            (sandboxLoading ? (
              <div
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
                aria-busy="true"
                aria-label="Loading sandbox status"
              >
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block h-4 w-2/3 animate-pulse rounded bg-slate-200" aria-hidden="true" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-slate-100" aria-hidden="true" />
                </span>
                <span className="sr-only">Loading sandbox status…</span>
              </div>
            ) : (
              <button
                onClick={() => setSandboxOpen(true)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm transition hover:bg-slate-50"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    sandbox?.vmLive ? 'bg-emerald-500' : sandbox?.vmSuspended ? 'bg-amber-400' : 'bg-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-wfnavy">
                    Sandbox · {sandbox?.state ?? '…'}
                  </span>
                  <span className="block truncate text-xs text-wfink">
                    {sandbox?.computerId ? 'Linux MicroVM' : 'no sandbox yet'}
                  </span>
                </span>
              </button>
            ))}
          {rentals.map((crew, ci) => {
            const live = crew.status === 'working';
            const bots: SidebarBot[] = crew.members
              .filter((m) => !query || `${m.name}${m.title}`.toLowerCase().includes(query.toLowerCase()))
              .map((m, i) => {
                const meta = memberMetaFor(m.role, m.name, m.title, i);
                return {
                  id: `m:${crew.taskId}:${m.role}`,
                  name: meta.name,
                  role: meta.title,
                  description: meta.description,
                  color: meta.color,
                  hexRole: meta.hexRole,
                };
              });
            if (bots.length === 0) return null;
            const label = live ? `${crew.team} · ${crew.minutesLeft}m left` : `${crew.team} · ${crew.status}`;
            const actions: { label: string; onClick: () => void; danger?: boolean }[] = [
              ...(live ? [{ label: 'Extend', onClick: () => onOpenTeams(crew) }] : []),
              { label: 'End', onClick: () => setEndTarget(crew), danger: true },
            ];
            return (
              <Section
                key={crew.taskId}
                title={label}
                bots={bots}
                startIndex={ci * 4}
                selectedId={selectedId}
                onSelect={onSelect}
                actions={actions}
              />
            );
          })}
          {rentals.length === 0 && (
          <button
            onClick={() => {
              if (!signedIn) {
                setModalOpen(true);
              } else if (ready) {
                onOpenTeams();
              }
            }}
            disabled={signedIn && !ready}
            className={`flex min-h-44 w-full flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-wfnavy/20 p-5 text-center transition hover:border-wfcta/60 hover:bg-white/60 disabled:cursor-wait ${
              signedIn && !ready ? 'animate-pulse' : ''
            }`}
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm">
              <Users className="h-6 w-6 text-wfcta" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-wfnavy">Hire your AI team</span>
              <span className="mt-0.5 block text-sm text-wfink">
                {!signedIn ? 'Connect a wallet, then pick a team' : 'Tap the team button above — your crew appears here when ready'}
              </span>
            </span>
          </button>
          )}
        </nav>

        <div className="border-t border-wfnavy/10 p-4">
          <ProfileName />
          <WalletFooter onOpen={() => setModalOpen(true)} onRequestTokens={() => setTokensOpen(true)} />
        </div>
      </aside>
      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ConfirmModal
        open={!!endTarget}
        title={endTarget ? `End the ${endTarget.team} rental?` : 'End rental?'}
        body="The clock stops and you can hire fresh. Chat history stays readable, escrowed funds stay claimable per job."
        confirmLabel="End rental"
        onClose={() => setEndTarget(null)}
        onConfirm={() => (endTarget ? handleEnd(endTarget) : Promise.resolve(null))}
      />
      <TokensModal
        open={tokensOpen}
        onClose={() => {
          tokensDismissed.current = true;
          setTokensOpen(false);
        }}
      />
      <SandboxPanel
        open={sandboxOpen}
        onClose={() => setSandboxOpen(false)}
        status={sandbox}
        onChanged={() => void refreshSandbox()}
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

function WalletFooter({ onOpen, onRequestTokens }: { onOpen: () => void; onRequestTokens: () => void }) {
  const { address, isConnected, isCorrectChain, disconnect, switchNetwork, balance } = useWallet();
  const { signedIn, signingIn, signIn, signOut, profile } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
              onClick={() => {
                setMenuOpen(false);
                onRequestTokens();
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-wfnavy hover:bg-wfice"
            >
              <Droplets className="h-4 w-4" strokeWidth={2.2} />
              Request test $U
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
                <LogIn className="h-4 w-4" strokeWidth={2.2} />
                {signingIn ? 'Check your wallet…' : 'Sign in'}
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setSettingsOpen(true);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-wfnavy hover:bg-wfice"
            >
              <Cog className="h-4 w-4" strokeWidth={2.2} />
              Settings
            </button>
            <div className="mx-4 my-1 border-t border-wfnavy/10" aria-hidden="true" />
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
            <img src="/connectors/living-brain.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/cournot.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
          </span>
        </button>
      </div>
      <ConnectorsModal open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddConnector={() => setConnectorsOpen(true)}
      />
    </div>
  );
}
