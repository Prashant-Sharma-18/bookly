import React, { useEffect, useState } from 'react';
import { CalendarOff, Loader2, Plus, X } from 'lucide-react';
import {
  DEFAULT_AVAILABILITY,
  formatDisplayDate,
  getHostTodayKey,
  getTimeLabel,
  HALF_HOURS,
  normalizeAvailability,
  parseDateKey
} from './booking.js';
import BusyTimes from './BusyTimes.jsx';

// Monday first, using JS weekday numbers.
const WEEKDAYS = [
  [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']
];
const BUFFER_OPTIONS = [0, 15, 30, 60];

// Key-order-independent comparison (Firestore may return map keys in a different order).
const canonical = (value) => JSON.stringify(value, (_, v) => (
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
));

const Section = ({ title, description, children }) => (
  <section className="card !rounded-2xl p-5 sm:p-6">
    <h3 className="font-semibold text-ink">{title}</h3>
    <p className="text-sm text-ink-2 mt-0.5 mb-5">{description}</p>
    {children}
  </section>
);

const Switch = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line'}`}
  >
    <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
  </button>
);

const TimeSelect = ({ value, onChange, options, label }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="field !w-auto !py-2 !pr-8 text-sm">
    {options.map(time => <option key={time} value={time}>{time === '24:00' ? 'Midnight' : getTimeLabel(time)}</option>)}
  </select>
);

export default function Settings({ services, blocks, syncing, onSync, onSaved, onError }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newDayOff, setNewDayOff] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => services.onSnapshot(
    services.doc(services.db, 'config', 'availability'),
    (snapshot) => {
      const next = normalizeAvailability(snapshot.data());
      setSaved(next);
      setDraft(current => current ?? next);
    },
    (error) => {
      console.error('Firestore Error:', error);
      onError('Unable to load availability settings.');
    }
  ), [services, onError]);

  if (!draft) {
    return <div className="card !rounded-2xl p-6 space-y-3"><div className="skeleton h-6 w-1/3" /><div className="skeleton h-40 w-full" /></div>;
  }

  const setDay = (day, hours) => setDraft({ ...draft, weekly: { ...draft.weekly, [day]: hours } });
  const invalidDays = WEEKDAYS.filter(([day]) => draft.weekly[day] && draft.weekly[day].start >= draft.weekly[day].end);
  const isDirty = canonical(draft) !== canonical(saved);
  const todayKey = getHostTodayKey();

  const addDayOff = () => {
    if (!newDayOff || draft.daysOff.includes(newDayOff)) return;
    setDraft({ ...draft, daysOff: [...draft.daysOff, newDayOff].sort() });
    setNewDayOff('');
  };

  const save = async () => {
    setIsSaving(true);
    try {
      // Drop past days off so the list doesn't grow forever.
      const toSave = { ...draft, daysOff: draft.daysOff.filter(day => day >= todayKey) };
      await services.setDoc(services.doc(services.db, 'config', 'availability'), toSave);
      setDraft(toSave);
      onSaved('Availability saved. The booking page is already using it.');
    } catch (error) {
      console.error('Save Error:', error);
      onError('Unable to save settings. Have you published the latest firestore.rules?');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-rise">
      <Section title="Weekly hours" description="When people can book you. Times are in India Standard Time.">
        <ul className="divide-y divide-line">
          {WEEKDAYS.map(([day, name]) => {
            const hours = draft.weekly[day];
            const isInvalid = invalidDays.some(([invalidDay]) => invalidDay === day);
            return (
              <li key={day} className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-3 w-36">
                  <Switch
                    checked={Boolean(hours)}
                    label={`Available on ${name}`}
                    onChange={(on) => setDay(day, on ? { ...DEFAULT_AVAILABILITY.weekly[1] } : null)}
                  />
                  <span className={`text-sm font-medium ${hours ? 'text-ink' : 'text-ink-3'}`}>{name}</span>
                </div>
                {hours ? (
                  <div className="flex items-center gap-2">
                    <TimeSelect label={`${name} start`} value={hours.start} options={HALF_HOURS.slice(0, -1)} onChange={(start) => setDay(day, { ...hours, start })} />
                    <span className="text-ink-3 text-sm">to</span>
                    <TimeSelect label={`${name} end`} value={hours.end} options={HALF_HOURS.slice(1)} onChange={(end) => setDay(day, { ...hours, end })} />
                    {isInvalid && <span className="text-xs font-medium text-danger">End must be after start</span>}
                  </div>
                ) : (
                  <span className="text-sm text-ink-3">Unavailable</span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <BusyTimes services={services} blocks={blocks} syncing={syncing} onSync={onSync} onNotice={onSaved} onError={onError} />

      <Section title="Days off" description="Holidays or days you're away. These dates can't be booked.">
        <div className="flex gap-2 mb-4 max-w-sm">
          <input
            type="date"
            min={todayKey}
            value={newDayOff}
            onChange={(e) => setNewDayOff(e.target.value)}
            aria-label="Day off"
            className="field !py-2 text-sm"
          />
          <button type="button" onClick={addDayOff} disabled={!newDayOff} className="btn btn-outline shrink-0">
            <Plus size={16} /> Add
          </button>
        </div>
        {draft.daysOff.length ? (
          <ul className="flex flex-wrap gap-2">
            {draft.daysOff.map(day => (
              <li key={day} className={`pill bg-muted border border-line !py-1.5 !pl-3 ${day < todayKey ? 'text-ink-3 line-through' : 'text-ink'}`}>
                {formatDisplayDate(parseDateKey(day), true)}
                <button
                  type="button"
                  aria-label={`Remove ${day}`}
                  onClick={() => setDraft({ ...draft, daysOff: draft.daysOff.filter(d => d !== day) })}
                  className="text-ink-3 hover:text-danger"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3 flex items-center gap-2"><CalendarOff size={16} /> No days off scheduled.</p>
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Buffer between meetings" description="Free time kept before and after each booking.">
          <div className="inline-flex p-1 rounded-full bg-muted border border-line">
            {BUFFER_OPTIONS.map(minutes => (
              <button
                key={minutes}
                type="button"
                aria-pressed={draft.bufferMinutes === minutes}
                onClick={() => setDraft({ ...draft, bufferMinutes: minutes })}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all
                  ${draft.bufferMinutes === minutes ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
              >
                {minutes === 0 ? 'None' : `${minutes}m`}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Daily limit" description="Most meetings you'll take in one day.">
          <select
            value={draft.maxPerDay}
            onChange={(e) => setDraft({ ...draft, maxPerDay: Number(e.target.value) })}
            aria-label="Daily limit"
            className="field !w-auto !py-2 !pr-8 text-sm"
          >
            <option value={0}>No limit</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n} meeting{n === 1 ? '' : 's'} a day</option>
            ))}
          </select>
        </Section>
      </div>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-full bg-surface/90 backdrop-blur border border-line shadow-[var(--shadow-card)] p-2 pl-5">
        <p className="text-sm text-ink-2 mr-auto">{isDirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
        {isDirty && (
          <button type="button" onClick={() => setDraft(saved)} disabled={isSaving} className="btn btn-ghost">Discard</button>
        )}
        <button type="button" onClick={save} disabled={!isDirty || isSaving || invalidDays.length > 0} className="btn btn-primary">
          {isSaving && <Loader2 size={16} className="animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}
