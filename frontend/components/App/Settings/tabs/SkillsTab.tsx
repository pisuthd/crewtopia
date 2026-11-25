'use client';

import { useState } from 'react';
import { getSkills, removeSkill } from '@/lib/api';
import { RemoveButton, TabHeader, useSandboxList } from '../shared';

export default function SkillsTab({ token }: { token: string }) {
  const { items: skills, setItems, error, setError } = useSandboxList(token, getSkills);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

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
      setItems(await removeSkill(token, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !skills) return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  if (!skills) return <p className="p-5 text-sm text-wfink">Loading skills…</p>;

  return (
    <div className="space-y-4 p-5">
      <TabHeader title="Skills" sub="What your bots know. Add one from chat with a repo link." />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {skills.length === 0 ? (
        <p className="text-sm text-wfink">No skills installed yet.</p>
      ) : (
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.name} className="rounded-xl border border-wfnavy/10 bg-wfice/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-brico text-sm font-bold text-wfnavy" title={s.source}>
                    {s.name}
                  </h4>
                  {!!s.description && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-wfink" title={s.description}>
                      {s.description}
                    </p>
                  )}
                </div>
                <RemoveButton
                  armed={confirming === s.name}
                  busy={busy}
                  onClick={() => onRemove(s.name)}
                  onCancel={() => setConfirming((c) => (c === s.name ? null : c))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
