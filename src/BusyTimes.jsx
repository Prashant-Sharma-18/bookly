import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { formatDisplayDate, getHostTodayKey, getTimeLabel, HALF_HOURS, parseDateKey } from './booking.js';
import { GoogleIcon } from './ui.jsx';

const timeAgo = (ms) => {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

const labelOf = (time) => (time === '24:00' ? 'midnight' : getTimeLabel(time));
const sortBlocks = (list) => [...list].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

const BlockRow = ({ block, onRemove }) => (
  <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-sm">
    <span className="text-ink">
      <span className="font-medium">{formatDisplayDate(parseDateKey(block.date))}</span>
      <span className="text-ink-2"> · {labelOf(block.start)} – {labelOf(block.end)}</span>
    </span>
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label="Remove busy time" className="text-ink-3 hover:text-danger shrink-0">
        <X size={16} />
      </button>
    )}
  </li>
);

export default function BusyTimes({ services, blocks, syncing, onSync, onNotice, onError }) {
  const [syncInfo, setSyncInfo] = useState(null);
  const [draft, setDraft] = useState({ date: '', start: '09:00', end: '10:00' });
  const [isAdding, setIsAdding] = useState(false);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => services.onSnapshot(
    services.doc(services.db, 'config', 'calendarSync'),
    (snapshot) => setSyncInfo(snapshot.data() || null),
    (error) => console.error('Firestore Error:', error)
  ), [services]);

  const todayKey = getHostTodayKey();
  const upcoming = blocks.filter(block => block.date >= todayKey);
  const manual = sortBlocks(upcoming.filter(block => block.source === 'manual'));
  const synced = sortBlocks(upcoming.filter(block => block.source === 'google'));
  const draftInvalid = !draft.date || draft.start >= draft.end;

  const addBlock = async () => {
    setIsAdding(true);
    try {
      await services.addDoc(services.collection(services.db, 'blocks'), { ...draft, source: 'manual' });
      onNotice(`Blocked ${formatDisplayDate(parseDateKey(draft.date))}, ${labelOf(draft.start)} – ${labelOf(draft.end)}.`);
      setDraft({ ...draft, date: '' });
    } catch (error) {
      console.error('Block Error:', error);
      onError('Unable to block that time. Have you published the latest firestore.rules?');
    } finally {
      setIsAdding(false);
    }
  };

  const removeBlock = async (block) => {
    try {
      await services.deleteDoc(services.doc(services.db, 'blocks', block.id));
    } catch (error) {
      console.error('Unblock Error:', error);
      onError('Unable to remove that busy time.');
    }
  };

  return (
    <section className="card !rounded-2xl p-5 sm:p-6">
      <h3 className="font-semibold text-ink">Busy times</h3>
      <p className="text-sm text-ink-2 mt-0.5 mb-5">Times nobody can book, on top of your weekly hours. Your buffer applies around them too.</p>

      <div className="rounded-2xl border border-line p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <span className="size-10 rounded-xl bg-muted grid place-items-center shrink-0"><GoogleIcon /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Google Calendar</p>
          <p className="text-sm text-ink-2">
            {syncInfo?.lastSyncedAt
              ? `Synced ${timeAgo(syncInfo.lastSyncedAt.toMillis())} · ${syncInfo.busyBlocks} busy block${syncInfo.busyBlocks === 1 ? '' : 's'} in the next 60 days`
              : 'Not synced yet. Your calendar meetings will be hidden from the booking page.'}
          </p>
          <p className="text-xs text-ink-3 mt-1">
            Reads only free/busy from your primary calendar, never event details. Re-syncs every 15 minutes while this page is open.
          </p>
        </div>
        <button type="button" onClick={onSync} disabled={syncing} className="btn btn-outline shrink-0">
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {synced.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowSynced(!showSynced)} className="btn btn-ghost -ml-3 text-sm">
            <ChevronDown size={16} className={`transition-transform ${showSynced ? 'rotate-180' : ''}`} />
            {showSynced ? 'Hide' : 'Show'} synced busy times ({synced.length})
          </button>
          {showSynced && (
            <ul className="mt-2 rounded-xl bg-muted px-4 py-3 divide-y divide-line max-h-64 overflow-y-auto animate-rise">
              {synced.map(block => <BlockRow key={block.id} block={block} />)}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6">
        <p className="text-sm font-medium text-ink mb-2">Block time manually</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            min={todayKey}
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            aria-label="Date to block"
            className="field !w-auto !py-2 text-sm"
          />
          <select value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} aria-label="Busy from" className="field !w-auto !py-2 !pr-8 text-sm">
            {HALF_HOURS.slice(0, -1).map(time => <option key={time} value={time}>{labelOf(time)}</option>)}
          </select>
          <span className="text-ink-3 text-sm">to</span>
          <select value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} aria-label="Busy until" className="field !w-auto !py-2 !pr-8 text-sm">
            {HALF_HOURS.slice(1).map(time => <option key={time} value={time}>{labelOf(time)}</option>)}
          </select>
          <button type="button" onClick={addBlock} disabled={draftInvalid || isAdding} className="btn btn-outline">
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Block
          </button>
        </div>
        {draft.date && draft.start >= draft.end && <p className="text-xs font-medium text-danger mt-2">End must be after start.</p>}

        {manual.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {manual.map(block => <BlockRow key={block.id} block={block} onRemove={() => removeBlock(block)} />)}
          </ul>
        ) : (
          <p className="text-sm text-ink-3 mt-3">No manual blocks. For whole days away, use Days off below.</p>
        )}
      </div>
    </section>
  );
}
