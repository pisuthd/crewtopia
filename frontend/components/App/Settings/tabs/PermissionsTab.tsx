'use client';

import { useState } from 'react';
import { getPermissions, setPermissions, undoPermissions, type PermissionRule } from '@/lib/api';
import { TabHeader, useSandboxList } from '../shared';

const ACTIONS = ['allow', 'ask', 'deny'] as const;
/** Denying these breaks basic chat — arm-confirm first. */
const CORE = new Set(['read', 'list', 'task']);

function actionStyle(active: boolean, action: string): string {
  if (!active) return 'text-wfink hover:text-wfnavy';
  if (action === 'allow') return 'bg-emerald-100 text-emerald-800';
  if (action === 'deny') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

export default function PermissionsTab({ token }: { token: string }) {
  const { items, setItems, error, setError } = useSandboxList<PermissionRule>(token, async (t) => {
    const out = await getPermissions(t);
    return out.rules;
  });
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arming, setArming] = useState<string | null>(null);

  const rules = items ?? [];

  const persist = async (next: PermissionRule[]): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await setPermissions(token, next);
      setItems(saved);
      setCanUndo(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setAction = async (idx: number, action: (typeof ACTIONS)[number]) => {
    const rule = rules[idx];
    const key = `${rule.permission ?? ''}:${rule.pattern ?? ''}`;
    const needsArm = action === 'deny' && CORE.has(String(rule.permission ?? ''));
    if (needsArm && arming !== key) {
      setArming(key);
      return;
    }
    setArming(null);
    if (String(rule.action) === action) return;
    const next = rules.map((r, i) => (i === idx ? { ...r, action } : r));
    await persist(next);
  };

  const undo = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const out = await undoPermissions(token);
      setItems(out.rules);
      setCanUndo(out.canUndo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !items) return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  if (!items) return <p className="p-5 text-sm text-wfink">Loading permissions…</p>;

  return (
    <div className="space-y-4 p-5">
      <TabHeader
        title="Permissions"
        sub="What bots may do without asking first."
        action={
          canUndo ? (
            <button
              onClick={() => void undo()}
              disabled={saving}
              className="rounded-full border border-wfnavy/15 px-3 py-1 text-xs font-bold text-wfnavy hover:bg-wfice disabled:opacity-50"
            >
              Undo
            </button>
          ) : undefined
        }
      />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {rules.length === 0 ? (
        <p className="text-sm text-wfink">No custom rules — bots ask before anything sensitive.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r, i) => {
            const key = `${r.permission ?? ''}:${r.pattern ?? ''}`;
            return (
              <li key={`${key}:${i}`} className="rounded-xl border border-wfnavy/10 bg-wfice/60 p-3">
                <p className="truncate font-mono text-xs font-bold text-wfnavy" title={String(r.permission ?? '')}>
                  {String(r.permission ?? '(rule)')}
                </p>
                {!!r.pattern && (
                  <p className="mt-0.5 truncate text-xs text-wfink" title={String(r.pattern)}>
                    {String(r.pattern)}
                  </p>
                )}
                <div className="mt-2 flex gap-1">
                  {ACTIONS.map((a) => {
                    const active = String(r.action) === a;
                    const armed = arming === key && a === 'deny';
                    return (
                      <button
                        key={a}
                        onClick={() => void setAction(i, a)}
                        disabled={saving}
                        title={armed ? 'Click again to confirm denying a core permission' : undefined}
                        className={`rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50 ${actionStyle(active, a)} ${armed ? 'ring-2 ring-red-600' : ''}`}
                      >
                        {armed ? 'Confirm deny?' : a}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
