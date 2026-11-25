'use client';

import { useEffect, useState } from 'react';
import { Download, File as FileIcon, Folder, Globe, Loader2, RefreshCw, SquareTerminal, X } from 'lucide-react';
import Hexbot, { type HexbotColor, type HexbotRole } from '../Hexbot';
import { useSession } from './SessionContext';
import {
  downloadWorkspaceFile,
  getSandboxStatus,
  getSandboxToken,
  listWorkspaceFiles,
  mintPreview,
  type LiveCrew,
  type WorkspaceEntry,
} from '@/lib/api';
import type { MemberMeta } from './crew';
import TerminalModal from './Terminal/TerminalModal';
import PreviewModal from './PreviewModal';

interface BotPanelProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  role: string;
  meta: MemberMeta;
  crew: LiveCrew | null;
}

type Tab = 'library' | 'computer';

function fmtSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

/** Right-side bot panel: Details / Library / Computer (swarm parity). */
export default function BotPanel({ open, onClose, taskId, role, meta, crew }: BotPanelProps) {
  const { token } = useSession();
  const [tab, setTab] = useState<Tab>('library');
  const [sandboxLive, setSandboxLive] = useState<boolean | null>(null);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [termAuth, setTermAuth] = useState<{ endpoint: string; authToken: string } | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  const [termBusy, setTermBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Sandbox liveness at a glance (own fetch — decoupled from the thread).
  useEffect(() => {
    if (!open || !token) return;
    getSandboxStatus(token)
      .then((s) => setSandboxLive(s ? s.vmLive : null))
      .catch(() => setSandboxLive(null));
  }, [open, token]);

  const loadFiles = async (path: string) => {
    if (!token) return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const out = await listWorkspaceFiles(token, path);
      setCwd(out.path);
      setEntries(out.entries);
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Could not list files.');
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (!open || tab !== 'library' || !token) return;
    void loadFiles(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, token]);

  const crumbs = cwd ? cwd.split('/').filter(Boolean) : [];
  const goCrumb = (i: number) => {
    void loadFiles(crumbs.slice(0, i + 1).join('/'));
  };

  const openTerminal = async () => {
    if (!token) return;
    setTermBusy(true);
    setTermError(null);
    try {
      const t = await getSandboxToken(token);
      setTermAuth(t);
      setTermOpen(true);
    } catch (e) {
      setTermError(e instanceof Error ? e.message : 'Could not mint a terminal token.');
    } finally {
      setTermBusy(false);
    }
  };

  const openPreview = async () => {
    if (!token) return;
    setPreviewBusy(true);
    try {
      const p = await mintPreview(token);
      setPreviewUrl(p.url);
      setPreviewOpen(true);
    } catch {
      setPreviewUrl(null);
      setPreviewOpen(true);
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div
      className={`shrink-0 overflow-hidden bg-white transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-80 border-l border-wfnavy/10 md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-80 flex-col px-5 py-4">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            aria-label="Close bot panel"
            className="grid h-9 w-9 place-items-center rounded-full bg-wfice text-wfnavy hover:bg-slate-100"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Hexbot color={meta.color as HexbotColor} size="md" role={meta.hexRole as HexbotRole} label={`${meta.name} hexbot`} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-brico text-lg font-bold text-wfnavy">{meta.name}</p>
            <p className="truncate text-xs text-wfink">{meta.title}</p>
          </div>
        </div>
        <p className="mt-1 text-xs text-wfink">{meta.description}</p>

        <div role="tablist" aria-label="Bot panel sections" className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-wfice p-1">
          {(['library', 'computer'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full py-1.5 text-xs font-bold capitalize transition ${
                tab === t ? 'bg-wfnavy text-white' : 'text-wfink hover:text-wfnavy'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5" role="tabpanel">
          {tab === 'library' && (
            <div>
              <div className="mb-2 flex items-center gap-1 text-xs">
                <button
                  onClick={() => void loadFiles('')}
                  className="rounded px-1.5 py-0.5 font-bold text-wfnavy hover:bg-wfice"
                >
                  workspace
                </button>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="text-wfink">/</span>
                    <button
                      onClick={() => goCrumb(i)}
                      className="max-w-24 truncate rounded px-1.5 py-0.5 font-bold text-wfnavy hover:bg-wfice"
                    >
                      {c}
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => void loadFiles(cwd)}
                  aria-label="Refresh files"
                  className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-wfink hover:bg-wfice"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${filesLoading ? 'animate-spin' : ''}`} strokeWidth={2.2} />
                </button>
              </div>
              {filesLoading && entries.length === 0 ? (
                <p className="py-6 text-center text-xs text-wfink">Loading files…</p>
              ) : filesError ? (
                <p className="py-6 text-center text-xs text-red-600">{filesError}</p>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-xs text-wfink">This folder is empty.</p>
              ) : (
                <ul className="divide-y divide-wfnavy/5">
                  {entries.map((e) => {
                    const rel = cwd ? `${cwd}/${e.name}` : e.name;
                    return (
                      <li key={rel} className="flex items-center gap-2 py-1.5">
                        {e.dir ? (
                          <Folder className="h-4 w-4 shrink-0 text-wfcta" strokeWidth={2} />
                        ) : (
                          <FileIcon className="h-4 w-4 shrink-0 text-wfink" strokeWidth={2} />
                        )}
                        <button
                          onClick={() => e.dir && void loadFiles(rel)}
                          disabled={!e.dir}
                          title={e.dir ? undefined : `${fmtSize(e.size)} · ${fmtDate(e.mtime)}`}
                          className={`min-w-0 flex-1 truncate text-left text-xs font-semibold ${e.dir ? 'text-wfnavy hover:underline' : 'text-wfnavy'}`}
                        >
                          {e.name}
                        </button>
                        {!e.dir && <span className="shrink-0 text-[10px] tabular-nums text-wfink">{fmtSize(e.size)}</span>}
                        {!e.dir && (
                          <button
                            onClick={() => {
                              if (!token || downloading) return;
                              setDownloading(rel);
                              downloadWorkspaceFile(token, rel)
                                .catch(() => {})
                                .finally(() => setDownloading(null));
                            }}
                            aria-label={`Download ${e.name}`}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-wfink hover:bg-wfice disabled:opacity-40"
                          >
                            {downloading === rel ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                            ) : (
                              <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
                            )}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-wfink">
                To delete or edit files, ask {meta.name} in the thread.
              </p>
            </div>
          )}

          {tab === 'computer' && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    sandboxLive ? 'bg-emerald-500' : sandboxLive === false ? 'bg-red-400' : 'bg-slate-300'
                  }`}
                />
                <p className="font-bold text-wfnavy">
                  {sandboxLive ? 'Live' : sandboxLive === false ? 'Not running' : '…'}
                </p>
                <span className="text-xs text-wfink">Linux MicroVM</span>
              </div>
              {crew && !crew.vmLive && (
                <p className="text-xs text-wfink">Boot the sandbox to use the terminal or preview.</p>
              )}
              <button
                onClick={() => void openTerminal()}
                disabled={termBusy || !sandboxLive}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-wfnavy px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {termBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareTerminal className="h-4 w-4" />}
                Open terminal
              </button>
              {termError && <p className="text-xs text-red-600">{termError}</p>}
              <button
                onClick={() => void openPreview()}
                disabled={previewBusy || !sandboxLive}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-wfnavy/15 px-3 py-2.5 text-sm font-semibold text-wfnavy disabled:opacity-40"
              >
                {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                Open preview
              </button>
            </div>
          )}
        </div>
      </div>
      <TerminalModal
        open={termOpen}
        onClose={() => {
          setTermOpen(false);
          setTermAuth(null);
        }}
        endpoint={termAuth?.endpoint ?? null}
        authToken={termAuth?.authToken ?? null}
        tokenError={termError}
      />
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} url={previewUrl} loadError={null} />
    </div>
  );
}
