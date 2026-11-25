'use client';

import { useEffect, useState } from 'react';

export function TabHeader({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="font-brico text-base font-bold text-wfnavy">{title}</h4>
        <p className="mt-0.5 text-sm text-wfink">{sub}</p>
      </div>
      {action}
    </div>
  );
}

export function useSandboxList<T>(token: string, load: (t: string) => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load(token)
      .then((v) => {
        if (alive) setItems(v);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load.');
      });
    return () => {
      alive = false;
    };
  }, [token]);
  return { items, setItems, error, setError };
}

export function RemoveButton({
  armed,
  busy,
  onClick,
  onCancel,
  label = 'Remove',
}: {
  armed: boolean;
  busy: boolean;
  onClick: () => void;
  onCancel: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      onBlur={() => {
        if (armed) onCancel();
      }}
      disabled={busy}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
        armed
          ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
          : 'border-red-200 text-red-600 hover:bg-red-50'
      }`}
    >
      {armed ? 'Confirm?' : label}
    </button>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-wfnavy/20';
  return <i className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={status} />;
}
