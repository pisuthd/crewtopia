'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Loader2, Plus, Trash2, Users, X } from 'lucide-react';
import ModalShell from './ModalShell';
import ConfirmModal from './ConfirmModal';
import FundCard from './FundCard';
import { useSession } from './SessionContext';
import {
  createQuote,
  createTeam,
  deleteTeam,
  getTeams,
  terminateSandbox,
  updateTeam,
  type LiveCrew,
  type PendingRent,
  type RentTeam,
} from '@/lib/api';

interface TeamModalProps {
  open: boolean;
  onClose: () => void;
  onHired: () => void;
  rentals: LiveCrew[];
  /** Open straight into top-up for this live rental. */
  renewTask: LiveCrew | null;
}

type Step =
  | { name: 'list' }
  | { name: 'detail'; team: RentTeam }
  | { name: 'renew'; team: RentTeam; crew: LiveCrew }
  | { name: 'addbot'; team: RentTeam }
  | { name: 'newteam' };

type Confirm =
  | { kind: 'end'; crew: LiveCrew }
  | { kind: 'delete'; team: RentTeam }
  | { kind: 'remove'; team: RentTeam; role: string; name: string };

const DEV_TEAM_ID = 'crewtopia-dev-crew';

/** Wire id of a live crew (old tasks predate teamId — those are dev-crew). */
function crewTeamId(crew: LiveCrew): string {
  return crew.teamId || DEV_TEAM_ID;
}

/** Live (working/funding) rental for a team, if any. */
export function activeRentalFor(rentals: LiveCrew[], teamId: string): LiveCrew | null {
  return rentals.find((r) => crewTeamId(r) === teamId && (r.status === 'working' || r.status === 'funding')) ?? null;
}

const MINUTE_PRESETS = [12, 30, 60];

export const ROLE_PRESETS = [
  { slug: 'coordinator', title: 'Coordinator', brief: 'Own the plan: triage the request, split the work across the roster with @mentions, and drive it to done.' },
  { slug: 'researcher', title: 'Researcher', brief: 'Gathers facts fast from docs and the web. Answers with sources, no fluff.' },
  { slug: 'assistant', title: 'Assistant', brief: 'General-purpose helper: picks up whatever the coordinator assigns and ships it.' },
];

export function briefTemplate(name: string, title: string, team: string, seed: string): string {
  return `You are ${name || 'the bot'}, ${title} on ${team}. ${seed} Report briefly and only on real progress.`;
}

function isCustom(team: RentTeam): boolean {
  return team.id.startsWith('custom-');
}

export default function TeamModal({ open, onClose, onHired, rentals, renewTask }: TeamModalProps) {
  const { token } = useSession();
  const [step, setStep] = useState<Step>({ name: 'list' });
  const [teams, setTeams] = useState<RentTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail/hire state.
  const [minutes, setMinutes] = useState(30);
  const [customMinutes, setCustomMinutes] = useState('');
  const [brief, setBrief] = useState('');
  const [quote, setQuote] = useState<PendingRent | null>(null);
  const [quoting, setQuoting] = useState(false);

  // New-team form.
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Renew target waiting for the team list.
  const [pendingRenew, setPendingRenew] = useState<LiveCrew | null>(null);

  // Pending destructive action (confirm modal instead of window.confirm).
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  useEffect(() => {
    if (!open || !pendingRenew || teams.length === 0) return;
    const team = teams.find((t) => t.id === crewTeamId(pendingRenew));
    if (!team) {
      setError('That rental’s team is no longer listed.');
      setPendingRenew(null);
      return;
    }
    setMinutes(30);
    setCustomMinutes('');
    setBrief('');
    setQuote(null);
    setError(null);
    setStep({ name: 'renew', team, crew: pendingRenew });
    setPendingRenew(null);
  }, [open, pendingRenew, teams]);

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await getTeams(token);
      setTeams(list);
      // Keep the open detail in sync (members added/removed elsewhere).
      setStep((s) => {
        if (s.name !== 'detail' && s.name !== 'addbot' && s.name !== 'renew') return s;
        const fresh = list.find((t) => t.id === s.team.id);
        if (!fresh) return { name: 'list' };
        if (s.name === 'renew') {
          const crew = rentals.find((r) => r.taskId === s.crew.taskId) ?? s.crew;
          return { ...s, team: fresh, crew };
        }
        return { ...s, team: fresh };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setQuote(null);
    setError(null);
    if (renewTask) {
      // Renew target known — resolve the team once the list lands.
      setStep({ name: 'list' });
      setPendingRenew(renewTask);
    } else {
      setStep({ name: 'list' });
      setPendingRenew(null);
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const effMinutes = customMinutes ? Number(customMinutes) : minutes;

  const handleQuote = async (team: RentTeam, renewCrew?: LiveCrew) => {
    if (!token || quoting) return;
    if (!Number.isFinite(effMinutes) || effMinutes < 6) {
      setError('Pick at least 6 minutes.');
      return;
    }
    setQuoting(true);
    setError(null);
    try {
      const q = await createQuote(token, {
        teamId: team.id,
        minutes: Math.round(effMinutes),
        brief,
        ...(renewCrew ? { renewTaskId: renewCrew.taskId } : {}),
      });
      setQuote(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  };

  const handleDeleteTeam = async (team: RentTeam): Promise<string | null> => {
    if (!token) return 'Sign in first.';
    try {
      await deleteTeam(token, team.id);
      await refresh();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  };

  const handleRemoveBot = async (team: RentTeam, role: string): Promise<string | null> => {
    if (!token) return 'Sign in first.';
    try {
      const out = await updateTeam(token, { teamId: team.id, remove: role });
      const fresh = { ...team, members: out.members, roles: out.members.map((m) => m.title) };
      setTeams((ts) => ts.map((t) => (t.id === team.id ? fresh : t)));
      setStep({ name: 'detail', team: fresh });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  };

  const handleEndRental = async (crew: LiveCrew): Promise<string | null> => {
    if (!token) return 'Sign in first.';
    try {
      await terminateSandbox(token, crew.taskId);
    } catch (e) {
      if (!(e instanceof Error && /already ended|unknown rental/i.test(e.message))) {
        return e instanceof Error ? e.message : 'Could not end the rental.';
      }
    }
    setQuote(null);
    setStep({ name: 'list' });
    onHired();
    return null;
  };

  const confirmCopy = confirm
    ? confirm.kind === 'end'
      ? {
          title: `End the ${confirm.crew.team} rental?`,
          body: 'The clock stops and you can hire fresh. Chat history stays readable, escrowed funds stay claimable per job.',
          label: 'End rental',
        }
      : confirm.kind === 'delete'
        ? {
            title: `Delete ${confirm.team.name}?`,
            body: 'Rentals already running are unaffected. This can\u2019t be undone.',
            label: 'Delete team',
          }
        : {
            title: `Remove ${confirm.name}?`,
            body: `They leave ${confirm.team.name} immediately. Running rentals keep their roster snapshot.`,
            label: 'Remove bot',
          }
    : null;

  const detail = step.name === 'detail' ? step.team : null;
  const addTarget = step.name === 'addbot' ? step.team : null;

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
              className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-wfnavy/10 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-brico text-lg font-bold text-wfnavy">
                  {step.name !== 'list' && (
                    <button
                      onClick={() => {
                        setQuote(null);
                        setError(null);
                        setStep({ name: 'list' });
                      }}
                      aria-label="Back to teams"
                      className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
                    >
                      <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  )}
                  {step.name === 'addbot' ? `Add a bot` : step.name === 'newteam' ? 'New team' : step.name === 'renew' ? 'Extend rental' : 'Hire a team'}
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                {step.name === 'list' && (
                  <>
                    {loading ? (
                      <p className="py-6 text-center text-sm text-wfink">Loading teams…</p>
                    ) : (
                      <div className="space-y-2">
                        {teams.map((t) => {
                          const live = activeRentalFor(rentals, t.id);
                          return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setQuote(null);
                              setError(null);
                              setMinutes(30);
                              setCustomMinutes('');
                              setBrief('');
                              setStep(
                                live ? { name: 'renew', team: t, crew: live } : { name: 'detail', team: t },
                              );
                            }}
                            className="flex w-full items-center gap-3 rounded-2xl border border-wfnavy/10 p-4 text-left transition hover:border-wfcta/60 hover:bg-wfice/50"
                          >
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-wfice">
                              <Users className="h-5 w-5 text-wfcta" strokeWidth={2.2} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate font-bold text-wfnavy">{t.name}</span>
                                {isCustom(t) && (
                                  <span className="shrink-0 rounded-full bg-wfice px-2 py-0.5 text-[11px] font-bold text-wfink">
                                    custom
                                  </span>
                                )}
                                {live && (
                                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
                                    {live.minutesLeft}m left · extend
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-sm text-wfink">
                                {t.roles.join(' · ')} — {t.rateUPerHour} $U/hr
                              </span>
                            </span>
                          </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setNewName('');
                        setNewDesc('');
                        setError(null);
                        setStep({ name: 'newteam' });
                      }}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-wfnavy/20 p-3 text-sm font-bold text-wfnavy transition hover:border-wfcta/60 hover:bg-wfice/50"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2.2} />
                      New custom team
                    </button>
                  </>
                )}

                {detail && (
                  <TeamDetail
                    team={detail}
                    minutes={minutes}
                    setMinutes={setMinutes}
                    customMinutes={customMinutes}
                    setCustomMinutes={setCustomMinutes}
                    brief={brief}
                    setBrief={setBrief}
                    quote={quote}
                    quoting={quoting}
                    onQuote={() => void handleQuote(detail)}
                    onAddBot={() => setStep({ name: 'addbot', team: detail })}
                    onDeleteTeam={() => setConfirm({ kind: 'delete', team: detail })}
                    onRemoveBot={(role) => {
                      const m = (detail.members ?? []).find((x) => x.role === role);
                      setConfirm({ kind: 'remove', team: detail, role, name: m?.name ?? role });
                    }}
                    onFunded={() => {
                      onHired();
                      onClose();
                    }}
                  />
                )}

                {step.name === 'renew' && (
                  <TeamDetail
                    team={step.team}
                    renewCrew={step.crew}
                    minutes={minutes}
                    setMinutes={setMinutes}
                    customMinutes={customMinutes}
                    setCustomMinutes={setCustomMinutes}
                    brief={brief}
                    setBrief={setBrief}
                    quote={quote}
                    quoting={quoting}
                    onQuote={() => void handleQuote(step.team, step.crew)}
                    onAddBot={() => setStep({ name: 'addbot', team: step.team })}
                    onDeleteTeam={() => setConfirm({ kind: 'delete', team: step.team })}
                    onRemoveBot={(role) => {
                      const m = (step.team.members ?? []).find((x) => x.role === role);
                      setConfirm({ kind: 'remove', team: step.team, role, name: m?.name ?? role });
                    }}
                    onEndRental={() => setConfirm({ kind: 'end', crew: step.crew })}
                    onFunded={() => {
                      onHired();
                      onClose();
                    }}
                  />
                )}

                {addTarget && (
                  <AddBotForm
                    teamId={addTarget.id}
                    teamName={addTarget.name}
                    existingRoles={(addTarget.members ?? []).map((m) => m.role)}
                    onCancel={() => setStep({ name: 'detail', team: addTarget })}
                    onSaved={(members) => {
                      const fresh = { ...addTarget, members, roles: members.map((m) => m.title) };
                      setTeams((ts) => ts.map((t) => (t.id === addTarget.id ? fresh : t)));
                      setStep({ name: 'detail', team: fresh });
                    }}
                    onError={setError}
                  />
                )}

                {step.name === 'newteam' && (
                  <NewTeamForm
                    name={newName}
                    setName={setNewName}
                    desc={newDesc}
                    setDesc={setNewDesc}
                    onCancel={() => setStep({ name: 'list' })}
                    onCreated={(teamId) => {
                      void refresh().then(() => {
                        setTeams((ts) => {
                          const created = ts.find((t) => t.id === teamId);
                          if (created) setStep({ name: 'detail', team: created });
                          return ts;
                        });
                      });
                    }}
                    onError={setError}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmModal
        open={!!confirm}
        title={confirmCopy?.title ?? 'Are you sure?'}
        body={confirmCopy?.body ?? ''}
        confirmLabel={confirmCopy?.label ?? 'Confirm'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return Promise.resolve(null);
          if (confirm.kind === 'end') return handleEndRental(confirm.crew);
          if (confirm.kind === 'delete') return handleDeleteTeam(confirm.team);
          return handleRemoveBot(confirm.team, confirm.role);
        }}
      />
    </ModalShell>
  );
}

function TeamDetail({
  team,
  renewCrew,
  minutes,
  setMinutes,
  customMinutes,
  setCustomMinutes,
  brief,
  setBrief,
  quote,
  quoting,
  onQuote,
  onAddBot,
  onDeleteTeam,
  onRemoveBot,
  onEndRental,
  onFunded,
}: {
  team: RentTeam;
  renewCrew?: LiveCrew;
  minutes: number;
  setMinutes: (n: number) => void;
  customMinutes: string;
  setCustomMinutes: (s: string) => void;
  brief: string;
  setBrief: (s: string) => void;
  quote: PendingRent | null;
  quoting: boolean;
  onQuote: () => void;
  onAddBot: () => void;
  onDeleteTeam: () => void;
  onRemoveBot: (role: string) => void;
  onEndRental?: () => void;
  onFunded: () => void;
}) {
  const custom = isCustom(team);
  return (
    <div>
      <p className="font-brico text-xl font-bold text-wfnavy">{team.name}</p>
      <p className="mt-1 text-sm text-wfink">{team.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(team.members ?? team.roles.map((r) => ({ role: r, name: r, title: r }))).map((m, i) => (
          <span
            key={`${m.role}-${i}`}
            className="flex items-center gap-1.5 rounded-full bg-wfice px-3 py-1 text-xs font-semibold text-wfnavy"
          >
            {m.name}{m.title && m.title !== m.name ? ` · ${m.title}` : ''}
            {custom && !renewCrew && (
              <button
                onClick={() => onRemoveBot(m.role)}
                aria-label={`Remove ${m.name}`}
                title={`Remove ${m.name}`}
                className="text-wfink hover:text-red-600"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
          </span>
        ))}
        {custom && !renewCrew && (
          <button
            onClick={onAddBot}
            aria-label="Add a bot"
            title="Add a bot"
            className="grid h-7 w-7 place-items-center rounded-full border-2 border-dashed border-wfnavy/20 text-wfnavy transition hover:border-wfcta/60"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-wfink">
          {renewCrew ? `Add time (running — ${renewCrew.minutesLeft}m left of ${Math.round(renewCrew.fundedSeconds / 60)}m funded)` : 'Rental time'}
        </p>
        <div className="mt-1.5 flex gap-2">
          {MINUTE_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMinutes(m);
                setCustomMinutes('');
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                !customMinutes && minutes === m ? 'bg-wfnavy text-white' : 'bg-wfice text-wfnavy hover:bg-slate-200'
              }`}
            >
              {m}m
            </button>
          ))}
          <input
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="Custom"
            inputMode="numeric"
            className="w-24 rounded-full bg-wfice px-4 py-1.5 text-sm font-bold text-wfnavy outline-none placeholder:font-medium placeholder:text-wfink focus:ring-2 focus:ring-wfcta/40"
          />
        </div>
      </div>

      {!renewCrew && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-wfink">What should they build? (optional)</p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="A todo app with…"
            className="mt-1.5 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
          />
        </div>
      )}

      {!quote ? (
        <button
          onClick={onQuote}
          disabled={quoting}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {quoting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
          {quoting ? 'Quoting…' : renewCrew ? `Extend ${team.name} · ${team.rateUPerHour} $U/hr` : `Hire ${team.name} · ${team.rateUPerHour} $U/hr`}
        </button>
      ) : (
        <div className="mt-4">
          <FundCard pending={quote} onFunded={onFunded} onCleared={() => {}} />
          <button onClick={onQuote} className="mt-2 w-full text-center text-xs font-semibold text-wfink hover:text-wfnavy">
            Re-quote with different time
          </button>
        </div>
      )}

      {custom && !renewCrew && (
        <button
          onClick={onDeleteTeam}
          className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-wfink hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          Delete team
        </button>
      )}
      {renewCrew && onEndRental && (
        <button
          onClick={onEndRental}
          className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-wfink hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          End rental instead — hire fresh
        </button>
      )}
    </div>
  );
}

function AddBotForm({
  teamId,
  teamName,
  existingRoles,
  onCancel,
  onSaved,
  onError,
}: {
  teamId: string;
  teamName: string;
  existingRoles: string[];
  onCancel: () => void;
  onSaved: (members: { role: string; name: string; title: string }[]) => void;
  onError: (e: string | null) => void;
}) {
  const { token } = useSession();
  const [preset, setPreset] = useState(ROLE_PRESETS[0].slug);
  const [customSlug, setCustomSlug] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState(ROLE_PRESETS[0].title);
  const [brief, setBrief] = useState('');
  const [briefTouched, setBriefTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const activePreset = ROLE_PRESETS.find((p) => p.slug === preset) ?? ROLE_PRESETS[0];
  const role = preset === '__custom' ? customSlug.toLowerCase().trim() : activePreset.slug;

  useEffect(() => {
    if (!briefTouched) setBrief(briefTemplate(name, title, teamName, activePreset.brief));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, title, preset]);

  const save = async () => {
    if (!token || !teamId || saving) return;
    if (!/^[a-z0-9-]{1,24}$/.test(role)) {
      onError('Role slug must be 1-24 chars: a-z, 0-9, dash.');
      return;
    }
    if (existingRoles.includes(role)) {
      onError(`Role '${role}' is already on this team.`);
      return;
    }
    if (!name.trim() || !title.trim() || !brief.trim()) {
      onError('Name, title, and brief are all required.');
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const out = await updateTeam(token, {
        teamId,
        add: { role, name: name.trim(), title: title.trim(), brief: brief.trim() },
      });
      onSaved(out.members);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AddBotFields
      preset={preset}
      setPreset={(s) => {
        setPreset(s);
        const p = ROLE_PRESETS.find((r) => r.slug === s);
        if (p && s !== '__custom') setTitle(p.title);
      }}
      customSlug={customSlug}
      setCustomSlug={setCustomSlug}
      name={name}
      setName={setName}
      title={title}
      setTitle={setTitle}
      brief={brief}
      setBrief={(v) => {
        setBrief(v);
        setBriefTouched(true);
      }}
      saving={saving}
      saveLabel="Add bot"
      onSave={() => void save()}
      onCancel={onCancel}
    />
  );
}

export interface AddBotFieldsProps {
  preset: string;
  setPreset: (s: string) => void;
  customSlug: string;
  setCustomSlug: (s: string) => void;
  name: string;
  setName: (s: string) => void;
  /** Custom slug only: hide the preset pills, always show the slug input. */
  customOnly?: boolean;
  title: string;
  setTitle: (s: string) => void;
  brief: string;
  setBrief: (s: string) => void;
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
}

export function AddBotFields({
  preset,
  setPreset,
  customSlug,
  setCustomSlug,
  name,
  setName,
  customOnly,
  title,
  setTitle,
  brief,
  setBrief,
  saving,
  saveLabel,
  onSave,
  onCancel,
}: AddBotFieldsProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-wfink">Role</p>
        {customOnly ? (
          <input
            value={customSlug}
            onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24))}
            placeholder="role-slug (e.g. researcher)"
            className="mt-1.5 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 font-mono text-sm text-wfnavy outline-none focus:border-wfcta"
          />
        ) : (
        <>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ROLE_PRESETS.map((p) => (
            <button
              key={p.slug}
              onClick={() => setPreset(p.slug)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                preset === p.slug ? 'bg-wfnavy text-white' : 'bg-wfice text-wfnavy hover:bg-slate-200'
              }`}
            >
              {p.title}
            </button>
          ))}
          <button
            onClick={() => setPreset('__custom')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              preset === '__custom' ? 'bg-wfnavy text-white' : 'bg-wfice text-wfnavy hover:bg-slate-200'
            }`}
          >
            Custom…
          </button>
        </div>
        {preset === '__custom' && (
          <input
            value={customSlug}
            onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24))}
            placeholder="role-slug (e.g. researcher)"
            className="mt-2 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 font-mono text-sm text-wfnavy outline-none focus:border-wfcta"
          />
        )}
        </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-wfink">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder="Atlas"
            className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-wfink">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder="Researcher"
            className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-wfink">Brief (what this bot does)</span>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value.slice(0, 2000))}
          rows={4}
          className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-full bg-wfice py-2.5 text-sm font-bold text-wfnavy hover:bg-slate-200"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

function NewTeamForm({
  name,
  setName,
  desc,
  setDesc,
  onCancel,
  onCreated,
  onError,
}: {
  name: string;
  setName: (s: string) => void;
  desc: string;
  setDesc: (s: string) => void;
  onCancel: () => void;
  onCreated: (teamId: string) => void;
  onError: (e: string | null) => void;
}) {
  const { token } = useSession();
  const [preset, setPreset] = useState(ROLE_PRESETS[0].slug);
  const [customSlug, setCustomSlug] = useState('');
  const [botName, setBotName] = useState('');
  const [botTitle, setBotTitle] = useState(ROLE_PRESETS[0].title);
  const [botBrief, setBotBrief] = useState('');
  const [briefTouched, setBriefTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const activePreset = ROLE_PRESETS.find((p) => p.slug === preset) ?? ROLE_PRESETS[0];
  const role = preset === '__custom' ? customSlug.toLowerCase().trim() : activePreset.slug;

  useEffect(() => {
    if (!briefTouched) setBotBrief(briefTemplate(botName, botTitle, name, activePreset.brief));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botName, botTitle, preset, name]);

  const save = async () => {
    if (!token || saving) return;
    if (!name.trim()) {
      onError('Give the team a name.');
      return;
    }
    if (!/^[a-z0-9-]{1,24}$/.test(role) || !botName.trim() || !botTitle.trim() || !botBrief.trim()) {
      onError('The first bot needs a valid role, name, title, and brief.');
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const out = await createTeam(token, {
        name: name.trim(),
        description: desc.trim(),
        members: [{ role, name: botName.trim(), title: botTitle.trim(), brief: botBrief.trim() }],
      });
      onCreated(out.teamId);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-wfink">Team name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Night Owls"
          className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-wfink">Description (optional)</span>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value.slice(0, 500))}
          placeholder="What this crew is for"
          className="mt-1 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
        />
      </label>
      <p className="pt-1 text-xs font-bold uppercase tracking-wide text-wfink">First bot</p>
      <AddBotFields
        preset={preset}
        setPreset={(s) => {
          setPreset(s);
          const p = ROLE_PRESETS.find((r) => r.slug === s);
          if (p && s !== '__custom') setBotTitle(p.title);
        }}
        customSlug={customSlug}
        setCustomSlug={setCustomSlug}
        name={botName}
        setName={setBotName}
        title={botTitle}
        setTitle={setBotTitle}
        brief={botBrief}
        setBrief={(v) => {
          setBotBrief(v);
          setBriefTouched(true);
        }}
        saving={saving}
        saveLabel="Create team"
        onSave={() => void save()}
        onCancel={onCancel}
      />
    </div>
  );
}
