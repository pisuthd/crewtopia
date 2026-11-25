'use client';

import { useState } from 'react';
import {
  getMcpServers,
  patchMcpServer,
  removeMcpServer,
  restartMcpServer,
  type McpServerInfo,
} from '@/lib/api';
import { RemoveButton, StatusDot, TabHeader, useSandboxList } from '../shared';

export default function McpTab({ token, onAdd }: { token: string; onAdd: () => void }) {
  const { items: servers, setItems, error, setError } = useSandboxList<McpServerInfo>(token, getMcpServers);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  const refresh = async () => {
    setItems(await getMcpServers(token));
  };

  const onToggle = async (s: McpServerInfo) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setItems(await patchMcpServer(token, s.name, { isActive: !s.isActive }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (name: string) => {
    if (confirming !== name) {
      setConfirming(name);
      return;
    }
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      setItems(await removeMcpServer(token, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  const onRestart = async (name: string) => {
    if (busy) return;
    setRestarting(name);
    setBusy(true);
    setError(null);
    try {
      setItems(await restartMcpServer(token, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed.');
      try {
        await refresh();
      } catch {
        /* refresh failure already surfaced */
      }
    } finally {
      setRestarting(null);
      setBusy(false);
    }
  };

  if (error && !servers) return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  if (!servers) return <p className="p-5 text-sm text-wfink">Loading MCP servers…</p>;

  return (
    <div className="space-y-4 p-5">
      <TabHeader
        title="MCP servers"
        sub="Tools wired into this sandbox. Add more via Connectors."
        action={
          <button
            onClick={() => void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Refresh failed.'))}
            disabled={busy}
            className="rounded-full border border-wfnavy/15 px-3 py-1 text-xs font-bold text-wfnavy hover:bg-wfice disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {servers.length === 0 ? (
        <p className="text-sm text-wfink">No MCP servers yet.</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.name} className="rounded-xl border border-wfnavy/10 bg-wfice/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="flex flex-wrap items-center gap-2 font-brico text-sm font-bold text-wfnavy">
                    <StatusDot status={s.status} />
                    {s.name}
                    <span className="rounded-full bg-wfnavy/10 px-2 py-0.5 text-[10px] font-bold text-wfink">
                      {s.type === 'stdio' ? 'local' : 'remote'} · {s.tools} tool{s.tools === 1 ? '' : 's'}
                    </span>
                    {!s.isActive && (
                      <span className="rounded-full bg-wfnavy/10 px-2 py-0.5 text-[10px] font-bold text-wfink">
                        off
                      </span>
                    )}
                  </h4>
                  {s.configKeys.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-wfink" title={s.configKeys.join(', ')}>
                      {s.configKeys.join(', ')}
                    </p>
                  )}
                  {s.status === 'error' && s.lastError && (
                    <p className="mt-0.5 line-clamp-2 text-xs font-medium text-red-600" title={s.lastError}>
                      {s.lastError.slice(0, 200)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => void onRestart(s.name)}
                    disabled={busy || !s.isActive}
                    title={s.isActive ? 'Reconnect this server' : 'Turn on first'}
                    className="rounded-full border border-wfnavy/15 px-3 py-1 text-xs font-bold text-wfnavy hover:bg-white disabled:opacity-50"
                  >
                    {restarting === s.name ? '…' : 'Restart'}
                  </button>
                  <button
                    onClick={() => void onToggle(s)}
                    disabled={busy}
                    className={`rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                      s.isActive
                        ? 'border-wfnavy/15 text-wfnavy hover:bg-white'
                        : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {s.isActive ? 'Off' : 'On'}
                  </button>
                  <RemoveButton
                    armed={confirming === s.name}
                    busy={busy}
                    onClick={() => onRemove(s.name)}
                    onCancel={() => setConfirming((c) => (c === s.name ? null : c))}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={onAdd}
        className="rounded-full border-2 border-wfnavy px-4 py-1.5 text-xs font-bold text-wfnavy hover:bg-wfnavy hover:text-white"
      >
        + Add via Connectors
      </button>
    </div>
  );
}
