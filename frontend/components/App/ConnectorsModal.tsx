'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import ModalShell from './ModalShell';
import { useSession } from './SessionContext';
import {
  bootSandbox,
  getMcpServers,
  getSandboxStatus,
  getSkills,
  installSkill,
  patchMcpServer,
  removeMcpServer,
  resolveSkill,
  restartMcpServer,
  saveMcpServer,
  type McpServerInfo,
  type SkillResolveResult,
} from '@/lib/api';

const LB_URL = 'https://livingbrain.fernmcp.dev/livingbrain';
const LB_NAME = 'living-brain';
/** Never offer destructive tools to the bots. */
const LB_DISABLED = ['brains_remove', 'workspace_delete_permanently'];
const SUBJECT_KEY = 'lb-subject';
const COURNOT_SOURCE = 'Cournot-AI/cournot-skills/skills/cournot';

function loadSubject(): string {
  try {
    const saved = localStorage.getItem(SUBJECT_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(SUBJECT_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

export default function ConnectorsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useSession();
  const [servers, setServers] = useState<Record<string, McpServerInfo>>({});
  const [skillNames, setSkillNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sandboxLive, setSandboxLive] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<'brain' | 'cournot' | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [subject, setSubject] = useState('');
  const [resolved, setResolved] = useState<SkillResolveResult | null>(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load registry when the modal opens (needs session + live sandbox).
  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    setLoading(true);
    setResult(null);
    setSubject(loadSubject());
    (async () => {
      try {
        const st = await getSandboxStatus(token).catch(() => null);
        if (!alive) return;
        setSandboxLive(!!st?.vmLive);
        if (!st?.vmLive) return;
        const [list, skills] = await Promise.all([
          getMcpServers(token).catch(() => []),
          getSkills(token).catch(() => []),
        ]);
        if (!alive) return;
        const map: Record<string, McpServerInfo> = {};
        for (const s of list) map[s.name] = s;
        setServers(map);
        setSkillNames(skills.map((s) => s.name));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      setApiKey('');
      setResolved(null);
      setResult(null);
    }
  }, [open ]);

  // Cournot card previews on open — one tap to install from there.
  useEffect(() => {
    if (detail === 'cournot' && token && sandboxLive && !resolved && !result && !working) {
      void doResolve();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, sandboxLive]);

  const installed = servers[LB_NAME];
  const cournotInstalled = (skillNames ?? []).some((n) => /cournot/i.test(n));

  async function refresh(): Promise<McpServerInfo[]> {
    if (!token) return [];
    const list = await getMcpServers(token);
    const map: Record<string, McpServerInfo> = {};
    for (const s of list) map[s.name] = s;
    setServers(map);
    return list;
  }

  async function doBoot() {
    if (!token || working) return;
    setWorking(true);
    setResult(null);
    try {
      await bootSandbox(token);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 15000));
        const st = await getSandboxStatus(token).catch(() => null);
        if (st?.vmLive) break;
      }
      const st = await getSandboxStatus(token).catch(() => null);
      setSandboxLive(!!st?.vmLive);
      if (st?.vmLive) await refresh().catch(() => []);
      else setResult({ ok: false, message: 'Sandbox is still booting — wait a minute and reopen.' });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Boot failed' });
    } finally {
      setWorking(false);
    }
  }

  async function doSave() {
    if (!token || working) return;
    const key = apiKey.trim();
    const sub = subject.trim();
    if (!key || !sub) {
      setResult({ ok: false, message: 'Paste your API key and confirm the subject id.' });
      return;
    }
    setWorking(true);
    setResult(null);
    try {
      localStorage.setItem(SUBJECT_KEY, sub);
    } catch { /* private mode — subject just won't persist */ }
    try {
      const cfg = {
        url: LB_URL,
        headers: { 'x-api-key': key, 'x-subject-id': sub },
        disabledTools: LB_DISABLED,
      };
      let list: McpServerInfo[];
      try {
        list = await saveMcpServer(token, { name: LB_NAME, ...cfg });
      } catch (err) {
        if (err instanceof Error && /exists|409/.test(err.message)) {
          list = await patchMcpServer(token, LB_NAME, cfg);
        } else {
          throw err;
        }
      }
      const after = await restartMcpServer(token, LB_NAME).catch(() => list);
      const map: Record<string, McpServerInfo> = {};
      for (const s of after) map[s.name] = s;
      setServers(map);
      const live = after.find((s) => s.name === LB_NAME);
      setApiKey('');
      setResult({
        ok: true,
        message:
          live && live.tools > 0
            ? `Connected — ${live.tools} Living Brain tools live for your bots.`
            : 'Saved, but the computer reports 0 tools — check the API key and subject, then retry.',
      });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setWorking(false);
    }
  }

  async function doRemove() {
    if (!token || working) return;
    setWorking(true);
    setResult(null);
    try {
      const list = await removeMcpServer(token, LB_NAME).catch(() => []);
      const map: Record<string, McpServerInfo> = {};
      for (const s of list) map[s.name] = s;
      setServers(map);
      setResult({ ok: true, message: 'Living Brain disconnected from this sandbox.' });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Remove failed' });
    } finally {
      setWorking(false);
    }
  }

  async function doResolve() {
    if (!token || working) return;
    setWorking(true);
    setResult(null);
    setResolved(null);
    try {
      const r = await resolveSkill(token, COURNOT_SOURCE);
      if (r.error) {
        setResult({ ok: false, message: r.error });
        return;
      }
      setResolved(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Resolve failed.' });
    } finally {
      setWorking(false);
    }
  }

  async function doInstall(overwrite = false) {
    if (!token || working) return;
    setWorking(true);
    setResult(null);
    try {
      const r = await installSkill(token, COURNOT_SOURCE, overwrite);
      if (r.error) {
        setResult({ ok: false, message: r.error });
        return;
      }
      if (r.choices) {
        setResolved({ choices: r.choices as SkillResolveResult['choices'], hint: r.hint });
        setResult({ ok: false, message: 'Unexpected multi-skill response — retry.' });
        return;
      }
      const skills = await getSkills(token).catch(() => []);
      setSkillNames(skills.map((s) => s.name));
      setResolved(null);
      setResult({ ok: true, message: 'Installed — your bots can load Cournot from chat now.' });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Install failed.' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.button
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-wfnavy/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            className="relative w-full max-w-md rounded-2xl border border-wfnavy/10 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-brico text-lg font-bold text-wfnavy">
                {detail && (
                  <button
                    onClick={() => { setDetail(null); setResult(null); setResolved(null); }}
                    aria-label="Back to list"
                    className="rounded-lg p-1 hover:bg-wfice"
                  >
                    <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                )}
                {detail === 'cournot' ? 'Cournot Intelligence' : detail === 'brain' ? 'Living Brain' : 'Connectors'}
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>

            {!token ? (
              <p className="mt-4 rounded-xl bg-wfice px-4 py-3 text-sm font-semibold text-wfnavy">
                Sign in to connect tools to your sandbox.
              </p>
            ) : !detail ? (
              <div className="mt-4 space-y-2">
                <button
                  onClick={() => setDetail('brain')}
                  className="flex w-full items-center gap-3 rounded-xl border border-wfnavy/10 px-4 py-3 text-left hover:bg-wfice/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/connectors/living-brain.png" alt="" className="h-10 w-10 rounded-xl bg-white object-contain" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-wfnavy">Living Brain</span>
                    <span className="block truncate text-xs text-wfink">Long-term memory your bots can read and write</span>
                  </span>
                  {installed ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      <Check className="h-3 w-3" /> Installed{installed.tools > 0 ? ` · ${installed.tools}` : ''}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-wfice px-2.5 py-1 text-xs font-bold text-wfnavy">Import</span>
                  )}
                </button>
                <button
                  onClick={() => setDetail('cournot')}
                  className="flex w-full items-center gap-3 rounded-xl border border-wfnavy/10 px-4 py-3 text-left hover:bg-wfice/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/connectors/cournot.png" alt="" className="h-10 w-10 rounded-xl bg-white object-contain" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-wfnavy">Cournot Intelligence</span>
                    <span className="block truncate text-xs text-wfink">Probability answers for crypto events</span>
                  </span>
                  {cournotInstalled ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      <Check className="h-3 w-3" /> Installed
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-wfice px-2.5 py-1 text-xs font-bold text-wfnavy">Import</span>
                  )}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-wfink">
                  More connectors land here — each one becomes tools your whole crew can use.
                </p>
              </div>
            ) : detail === 'brain' ? (
              <div className="mt-4">
                <p className="text-sm leading-relaxed text-wfnavy">
                  Give your crew long-term memory. Any bot can record notes and
                  decisions; the whole crew recalls them with search.
                </p>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-wfnavy">
                  <li>Get an API key from your Living Brain dashboard.</li>
                  <li>Confirm the subject id below (one memory per subject — yours is saved on this device).</li>
                  <li>Import — the key is written to <span className="font-mono text-xs">your sandbox only</span>, never shared.</li>
                </ol>
                {sandboxLive === false && (
                  <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm">
                    <p className="font-semibold text-wfnavy">Sandbox isn&apos;t running.</p>
                    <button
                      onClick={doBoot}
                      disabled={working}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {working && <Loader2 className="h-4 w-4 animate-spin" />}
                      Boot sandbox
                    </button>
                  </div>
                )}
                <label className="mt-4 block text-xs font-bold text-wfnavy">API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={installed ? '•••••• (saved — paste to replace)' : 'lbk_…'}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-xl border border-wfnavy/15 bg-white px-4 py-2.5 font-mono text-sm text-wfnavy outline-none placeholder:text-wfink/60 focus:border-cta"
                />
                <label className="mt-3 block text-xs font-bold text-wfnavy">Subject id</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="UUID for this memory owner"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-xl border border-wfnavy/15 bg-white px-4 py-2.5 font-mono text-xs text-wfnavy outline-none placeholder:text-wfink/60 focus:border-cta"
                />
                <p className="mt-2 text-xs text-wfink">
                  Destructive tools stay off: <span className="font-mono">{LB_DISABLED.join(', ')}</span>
                </p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  {installed ? (
                    <button
                      onClick={doRemove}
                      disabled={working}
                      className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : <span />}
                  <button
                    onClick={doSave}
                    disabled={working || sandboxLive !== true}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cta px-5 py-2 text-sm font-bold text-white hover:bg-ctahover disabled:opacity-50"
                  >
                    {working && <Loader2 className="h-4 w-4 animate-spin" />}
                    {installed ? 'Update' : 'Import'}
                  </button>
                </div>
                {result && (
                  <p className={`mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {result.message}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm leading-relaxed text-wfnavy">
                  Probability answers for crypto events. Ask <span className="font-mono text-xs">/cournot</span> in
                  chat — get a number, the claim it was computed against, and the sources behind it.
                </p>
                <p className="mt-2 text-xs text-wfink">
                  Skill installs free. Answers cost Cournot calls (3 free/account, then paid) — needs your Cournot account.
                </p>
                {sandboxLive === false && (
                  <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm">
                    <p className="font-semibold text-wfnavy">Sandbox isn&apos;t running.</p>
                    <button
                      onClick={doBoot}
                      disabled={working}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {working && <Loader2 className="h-4 w-4 animate-spin" />}
                      Boot sandbox
                    </button>
                  </div>
                )}
                <div className="mt-4 rounded-xl border border-wfnavy/10 bg-wfice/60 px-4 py-3">
                  <p className="font-mono text-[11px] text-wfink">{COURNOT_SOURCE}</p>
                  {!resolved?.preview && (
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={doResolve}
                        disabled={working || sandboxLive !== true}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-wfnavy px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {working && <Loader2 className="h-4 w-4 animate-spin" />}
                        Preview
                      </button>
                    </div>
                  )}
                </div>
                {resolved?.preview && (
                  <div className="mt-3 rounded-xl border border-wfnavy/10 bg-wfice/60 p-4">
                    <p className="font-brico text-sm font-bold text-wfnavy">{resolved.preview.name}</p>
                    {!!resolved.preview.description && (
                      <p className="mt-1 text-sm text-wfink">{resolved.preview.description}</p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-wfink">
                      {(resolved.preview.files ?? []).length} file(s) · {resolved.preview.source}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => doInstall()}
                        disabled={working}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cta px-5 py-2 text-sm font-bold text-white hover:bg-ctahover disabled:opacity-50"
                      >
                        {working && <Loader2 className="h-4 w-4 animate-spin" />}
                        Install skill
                      </button>
                    </div>
                  </div>
                )}
                {resolved?.choices && (
                  <div className="mt-3 rounded-xl border border-wfnavy/10 bg-wfice/60 p-4">
                    <p className="text-sm font-bold text-wfnavy">That source holds several skills:</p>
                    <p className="mt-1 text-xs text-wfink">{resolved.hint ?? 'Refine the source to one skill path, then preview again.'}</p>
                    <ul className="mt-2 space-y-1">
                      {(resolved.choices ?? []).slice(0, 8).map((c: any, i: number) => (
                        <li key={`${c?.path ?? c?.name ?? i}`} className="truncate font-mono text-xs text-wfnavy">
                          {String(c?.path ?? c?.name ?? '')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result && (
                  <p className={`mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {result.message}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-wfink hover:bg-wfice hover:text-wfnavy"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
