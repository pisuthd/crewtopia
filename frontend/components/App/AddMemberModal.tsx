'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import ModalShell from './ModalShell';
import { useSession } from './SessionContext';
import { AddBotFields, briefTemplate } from './TeamModal';
import { addCrewMember, getMemberHistory, type LiveCrew } from '@/lib/api';

interface AddMemberModalProps {
  open: boolean;
  onClose: () => void;
  rentals: LiveCrew[];
  onChanged: () => void;
}

/** Mid-rental add-member: pick a working crew, define the bot, boot them
 * into the live session. Billing is per-team, so this costs nothing extra. */
export default function AddMemberModal({ open, onClose, rentals, onChanged }: AddMemberModalProps) {
  const { token } = useSession();
  const working = rentals.filter((r) => r.status === 'working');
  const [crewId, setCrewId] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [briefTouched, setBriefTouched] = useState(false);
  const [saveToTeam, setSaveToTeam] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ role: string; name: string } | null>(null);
  const [saidHello, setSaidHello] = useState(false);

  const crew = working.find((r) => r.taskId === crewId) ?? working[0] ?? null;
  const role = customSlug.toLowerCase().trim();
  const isCustomTeam = (crew?.teamId ?? '').startsWith('custom-');

  useEffect(() => {
    if (!open) return;
    setCrewId(working[0]?.taskId ?? '');
    setCustomSlug('');
    setName('');
    setTitle('');
    setBrief('');
    setBriefTouched(false);
    setSaveToTeam(false);
    setSaving(false);
    setError(null);
    setJoined(null);
    setSaidHello(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!briefTouched) setBrief(briefTemplate(name, title, crew?.team ?? 'the crew', 'Picks up whatever the crew needs and ships it.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, title, crew?.taskId]);

  // After accept: watch the newcomer's thread for their hello.
  useEffect(() => {
    if (!open || !token || !joined || !crew || saidHello) return;
    let stopped = false;
    let tries = 0;
    const check = async () => {
      tries += 1;
      const h = await getMemberHistory(token, crew.taskId, joined.role).catch(() => null);
      if (stopped) return;
      if (h && h.messages.length > 0) {
        console.debug(`[crew-add-member] ${joined.role} said hello`);
        setSaidHello(true);
        return;
      }
      if (tries < 18) setTimeout(() => void check(), 10000);
    };
    void check();
    return () => {
      stopped = true;
    };
  }, [open, token, joined, crew, saidHello]);

  const save = async () => {
    if (!token || !crew || saving) return;
    if (!/^[a-z0-9-]{1,24}$/.test(role)) {
      setError("Role slug must be 1-24 chars: a-z, 0-9, dash.");
      return;
    }
    if (crew.members.some((m) => m.role === role)) {
      setError(`Role '${role}' is already on this crew.`);
      return;
    }
    if (crew.members.length >= 6) {
      setError('This crew is full (max 6 members).');
      return;
    }
    if (!name.trim() || !title.trim() || !brief.trim()) {
      setError('Name, title, and brief are all required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const out = await addCrewMember(token, {
        taskId: crew.taskId,
        add: { role, name: name.trim(), title: title.trim(), brief: brief.trim() },
        ...(saveToTeam && isCustomTeam ? { saveToTeam: true } : {}),
      });
      console.debug(`[crew-add-member] ${out.role} joining ${crew.taskId}`);
      setJoined({ role: out.role, name: out.name });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the bot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-wfnavy/60 p-4"
            onClick={joined ? onClose : undefined}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Add a team member"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="font-brico text-lg font-bold text-wfnavy">Add a team member</p>
                <button
                  onClick={onClose}
                  aria-label="Close add member"
                  className="grid h-9 w-9 place-items-center rounded-full bg-wfice text-wfnavy hover:bg-slate-100"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {working.length === 0 ? (
                <p className="text-sm text-wfink">
                  No working crew right now — hire a team first. New members can only join a live rental.
                </p>
              ) : joined ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl bg-wfice px-3 py-2.5 text-xs font-semibold text-wfnavy">
                    {saidHello ? null : <Loader2 className="h-4 w-4 animate-spin" />}
                    {saidHello
                      ? `${joined.name} joined ${crew?.team ?? 'the crew'} — say hi in their thread.`
                      : `${joined.name} is joining ${crew?.team ?? 'the crew'}… they’ll say hello in their thread shortly.`}
                  </div>
                  <button
                    onClick={onClose}
                    className="w-full rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {working.length > 1 && (
                    <label className="mb-3 block">
                      <span className="text-xs font-bold uppercase tracking-wide text-wfink">Crew</span>
                      <select
                        value={crew?.taskId ?? ''}
                        onChange={(e) => setCrewId(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm font-bold text-wfnavy outline-none focus:border-wfcta"
                      >
                        {working.map((r) => (
                          <option key={r.taskId} value={r.taskId}>
                            {r.team} ({r.members.length}/6 · {r.minutesLeft}m left)
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {crew && working.length === 1 && (
                    <p className="mb-3 text-sm text-wfink">
                      Joining <span className="font-bold text-wfnavy">{crew.team}</span>.
                    </p>
                  )}
                  <AddBotFields
                    preset=""
                    setPreset={() => {}}
                    customSlug={customSlug}
                    setCustomSlug={setCustomSlug}
                    name={name}
                    setName={setName}
                    customOnly
                    title={title}
                    setTitle={setTitle}
                    brief={brief}
                    setBrief={(v) => {
                      setBrief(v);
                      setBriefTouched(true);
                    }}
                    saving={saving}
                    saveLabel="Add to live crew"
                    onSave={() => void save()}
                    onCancel={onClose}
                  />
                  {isCustomTeam && (
                    <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-wfnavy">
                      <input
                        type="checkbox"
                        checked={saveToTeam}
                        onChange={(e) => setSaveToTeam(e.target.checked)}
                        className="h-4 w-4 accent-wfnavy"
                      />
                      Also save to the team template (next hire includes them)
                    </label>
                  )}
                </>
              )}
              {error && <p className="pt-2 text-sm text-red-600">{error}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
