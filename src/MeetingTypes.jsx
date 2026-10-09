import React, { useEffect, useState } from 'react';
import { Check, Copy, ListPlus, Loader2, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import {
  DEFAULT_EVENT_TYPE,
  DURATION_OPTIONS,
  formatDuration,
  getBookingUrl,
  slugify,
  sortEventTypes,
  MAX_QUESTIONS,
  QUESTION_KINDS,
  TYPE_ID_PATTERN
} from './booking.js';

const EMPTY_TYPE = { id: '', title: '', duration: 30, description: '', meetingLink: '', autoConfirm: false, active: true, questions: [] };
const newQuestion = () => ({ id: Math.random().toString(36).slice(2, 10), label: '', kind: 'short', required: false, options: [] });
const cleanOptions = (options) => options.map(option => option.trim()).filter(Boolean);

const Toggle = ({ checked, onChange, label }) => (
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

const validate = (draft, isNew, existingIds) => {
  if (!draft.title.trim()) return 'Give the meeting type a name.';
  if (draft.title.trim().length > 80) return 'Keep the name under 80 characters.';
  if (!TYPE_ID_PATTERN.test(draft.id)) return 'The link name can only use lowercase letters, numbers and dashes.';
  if (isNew && existingIds.includes(draft.id)) return 'Another meeting type already uses that link name.';
  if (draft.meetingLink && !/^https:\/\/\S+$/.test(draft.meetingLink.trim())) return 'The meeting link must start with https://';
  if (draft.description.length > 500) return 'Keep the description under 500 characters.';
  for (const question of draft.questions) {
    if (!question.label.trim()) return 'Every question needs a label.';
    if (question.label.trim().length > 120) return 'Keep question labels under 120 characters.';
    if (question.kind === 'choice' && cleanOptions(question.options).length < 2) return `"${question.label || 'Multiple choice'}" needs at least two options.`;
  }
  return '';
};

// Extra fields on the booking form for this meeting type (name and email are always asked).
function QuestionsEditor({ questions, onChange }) {
  const update = (index, fields) => onChange(questions.map((question, i) => (i === index ? { ...question, ...fields } : question)));

  return (
    <div>
      <p className="text-sm font-medium text-ink">Booking form questions</p>
      <p className="text-sm text-ink-2 mb-3">Asked after name and email. Answers appear on the booking and in your email.</p>
      <ul className="space-y-3">
        {questions.map((question, index) => (
          <li key={question.id} className="rounded-xl border border-line p-3.5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="field !py-2 text-sm flex-1 min-w-[12rem]"
                value={question.label}
                placeholder="e.g. Company name"
                aria-label={`Question ${index + 1}`}
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <select
                className="field !w-auto !py-2 !pr-8 text-sm"
                value={question.kind}
                aria-label={`Question ${index + 1} type`}
                onChange={(e) => update(index, { kind: e.target.value })}
              >
                {QUESTION_KINDS.map(kind => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => onChange(questions.filter((_, i) => i !== index))}
                aria-label={`Remove question ${index + 1}`}
                className="btn btn-ghost !p-2 hover:!text-danger"
              >
                <X size={16} />
              </button>
            </div>
            {question.kind === 'choice' && (
              <textarea
                rows={3}
                className="field !py-2 text-sm resize-none"
                value={question.options.join('\n')}
                placeholder={'One option per line\nFirst option\nSecond option'}
                aria-label={`Options for question ${index + 1}`}
                onChange={(e) => update(index, { options: e.target.value.split('\n') })}
              />
            )}
            <label className="flex items-center gap-2.5 text-sm text-ink-2">
              <Toggle checked={question.required} label={`Question ${index + 1} required`} onChange={(required) => update(index, { required })} />
              Required
            </label>
          </li>
        ))}
      </ul>
      {questions.length < MAX_QUESTIONS ? (
        <button type="button" onClick={() => onChange([...questions, newQuestion()])} className="btn btn-ghost -ml-3 mt-2 text-sm">
          <ListPlus size={16} /> Add question
        </button>
      ) : (
        <p className="text-xs text-ink-3 mt-2">Up to {MAX_QUESTIONS} questions per meeting type.</p>
      )}
    </div>
  );
}

function TypeEditor({ initial, isNew, existingIds, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(initial);
  const [idTouched, setIdTouched] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const problem = validate(draft, isNew, existingIds);

  const save = async () => {
    setIsSaving(true);
    try {
      await onSave({
        ...draft,
        title: draft.title.trim(),
        meetingLink: draft.meetingLink.trim(),
        description: draft.description.trim(),
        questions: draft.questions.map(question => ({
          ...question,
          label: question.label.trim(),
          options: question.kind === 'choice' ? cleanOptions(question.options).slice(0, 10) : []
        }))
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand/40 bg-surface p-4 sm:p-5 space-y-4 animate-rise">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Name</span>
          <input
            className="field !py-2 text-sm"
            value={draft.title}
            placeholder="Intro call"
            onChange={(e) => setDraft({ ...draft, title: e.target.value, ...(idTouched ? {} : { id: slugify(e.target.value) }) })}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Length</span>
          <select className="field !py-2 text-sm" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) })}>
            {DURATION_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink mb-1.5">Link name {!isNew && <span className="text-ink-3 font-normal">(can't be changed)</span>}</span>
        <div className="flex items-center rounded-[0.875rem] border border-line bg-muted text-sm overflow-hidden focus-within:border-brand">
          <span className="pl-3.5 text-ink-3 whitespace-nowrap">…/#book/</span>
          <input
            className="flex-1 min-w-0 bg-transparent py-2 pr-3 outline-none text-ink disabled:text-ink-2"
            value={draft.id}
            disabled={!isNew}
            placeholder="intro-call"
            onChange={(e) => { setIdTouched(true); setDraft({ ...draft, id: e.target.value.toLowerCase() }); }}
          />
        </div>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-ink mb-1.5">Description <span className="text-ink-3 font-normal">Optional</span></span>
        <textarea
          rows={2}
          className="field !py-2 text-sm resize-none"
          value={draft.description}
          placeholder="What this meeting is for."
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-ink mb-1.5">Meeting link <span className="text-ink-3 font-normal">Optional, e.g. your personal Meet or Zoom room</span></span>
        <input
          type="url"
          className="field !py-2 text-sm"
          value={draft.meetingLink}
          placeholder="https://meet.google.com/abc-defg-hij"
          onChange={(e) => setDraft({ ...draft, meetingLink: e.target.value })}
        />
      </label>

      <QuestionsEditor questions={draft.questions} onChange={(questions) => setDraft({ ...draft, questions })} />

      <div className="flex items-start gap-3 rounded-xl bg-muted p-3.5">
        <Toggle checked={draft.autoConfirm} label="Confirm instantly" onChange={(autoConfirm) => setDraft({ ...draft, autoConfirm })} />
        <div className="text-sm">
          <p className="font-medium text-ink">Confirm instantly</p>
          <p className="text-ink-2">
            {draft.autoConfirm
              ? 'Bookings are confirmed right away and the guest gets the meeting link immediately.'
              : 'You approve each request on the admin page or from the email.'}
          </p>
        </div>
      </div>

      {problem && <p className="text-xs font-medium text-danger">{problem}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={save} disabled={Boolean(problem) || isSaving} className="btn btn-primary">
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {isNew ? 'Create' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={isSaving} className="btn btn-ghost">Cancel</button>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={isSaving} className="btn btn-ghost !text-danger hover:!bg-danger-soft ml-auto">
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function MeetingTypes({ services, onNotice, onError }) {
  const [types, setTypes] = useState(null); // null = loading; [] = none saved yet (default in use)
  const [editingId, setEditingId] = useState(null); // type id, or 'new'

  useEffect(() => services.onSnapshot(
    services.collection(services.db, 'eventTypes'),
    (snapshot) => setTypes(sortEventTypes(snapshot.docs.map(snapshotDoc => ({ ...DEFAULT_EVENT_TYPE, id: snapshotDoc.id, ...snapshotDoc.data() })))),
    (error) => {
      console.error('Firestore Error:', error);
      onError('Unable to load meeting types. Have you published the latest firestore.rules?');
    }
  ), [services, onError]);

  if (!types) return <div className="card !rounded-2xl p-6"><div className="skeleton h-24 w-full" /></div>;

  const usingDefault = types.length === 0;
  const shown = usingDefault ? [DEFAULT_EVENT_TYPE] : types;
  const existingIds = types.map(type => type.id);

  const writeType = async ({ id, ...fields }, order) => {
    try {
      await services.setDoc(services.doc(services.db, 'eventTypes', id), {
        title: fields.title,
        duration: fields.duration,
        description: fields.description,
        meetingLink: fields.meetingLink,
        questions: fields.questions || [],
        autoConfirm: fields.autoConfirm,
        active: fields.active,
        order
      });
      setEditingId(null);
      onNotice(`"${fields.title}" saved. Its booking link is ${getBookingUrl(id)}`);
    } catch (error) {
      console.error('Save Error:', error);
      onError('Unable to save the meeting type. Have you published the latest firestore.rules?');
    }
  };

  const setActive = async (type, active) => {
    if (usingDefault) return writeType({ ...type, active }, 0);
    try {
      await services.setDoc(services.doc(services.db, 'eventTypes', type.id), { active }, { merge: true });
    } catch (error) {
      console.error('Save Error:', error);
      onError('Unable to update the meeting type.');
    }
  };

  const remove = async (type) => {
    if (!window.confirm(`Delete "${type.title}"? Existing bookings keep their details, but the link stops working.`)) return;
    try {
      await services.deleteDoc(services.doc(services.db, 'eventTypes', type.id));
      setEditingId(null);
      onNotice(`"${type.title}" deleted.`);
    } catch (error) {
      console.error('Delete Error:', error);
      onError('Unable to delete the meeting type.');
    }
  };

  const copyLink = async (type) => {
    try {
      await navigator.clipboard.writeText(getBookingUrl(type.id));
      onNotice(`Copied ${getBookingUrl(type.id)}`);
    } catch {
      onError(`Couldn't copy. The link is ${getBookingUrl(type.id)}`);
    }
  };

  const nextOrder = Math.max(0, ...types.map(type => type.order ?? 0)) + 1;
  const activeCount = shown.filter(type => type.active !== false).length;

  return (
    <section className="card !rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="font-semibold text-ink">Meeting types</h3>
          <p className="text-sm text-ink-2 mt-0.5">
            What people can book. {activeCount > 1 ? 'Your main booking link shows a picker.' : 'With one active type, your main link opens it directly.'}
          </p>
        </div>
        {editingId !== 'new' && (
          <button type="button" onClick={() => setEditingId('new')} className="btn btn-outline"><Plus size={16} /> New type</button>
        )}
      </div>

      <ul className="space-y-3">
        {editingId === 'new' && (
          <li>
            <TypeEditor
              initial={EMPTY_TYPE}
              isNew
              existingIds={usingDefault ? [] : existingIds}
              onSave={async (draft) => {
                // The unsaved default would disappear once any type exists, so keep it.
                if (usingDefault) await writeType(DEFAULT_EVENT_TYPE, 0);
                await writeType(draft, usingDefault ? 1 : nextOrder);
              }}
              onCancel={() => setEditingId(null)}
            />
          </li>
        )}
        {shown.map(type => (
          <li key={type.id}>
            {editingId === type.id ? (
              <TypeEditor
                initial={type}
                isNew={false}
                existingIds={existingIds}
                onSave={(draft) => writeType(draft, type.order ?? 0)}
                onCancel={() => setEditingId(null)}
                onDelete={usingDefault ? null : () => remove(type)}
              />
            ) : (
              <div className={`rounded-2xl border border-line p-4 flex flex-wrap items-center gap-3 ${type.active === false ? 'opacity-60' : ''}`}>
                <span className="size-11 shrink-0 rounded-xl bg-brand-soft text-brand-ink grid place-items-center text-xs font-bold">
                  {type.duration < 60 ? `${type.duration}m` : `${type.duration / 60}h`}
                </span>
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-semibold text-ink">
                    {type.title}
                    {usingDefault && <span className="ml-2 text-xs font-normal text-ink-3">(default, not saved yet)</span>}
                  </p>
                  <p className="text-sm text-ink-3 truncate">…/#book/{type.id}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {type.autoConfirm
                      ? <span className="pill bg-success-soft text-success"><Zap size={12} /> Instant</span>
                      : <span className="pill bg-muted text-ink-2">Needs approval</span>}
                    {type.meetingLink && <span className="pill bg-muted text-ink-2">Fixed link</span>}
                    {type.questions?.length > 0 && (
                      <span className="pill bg-muted text-ink-2">{type.questions.length} question{type.questions.length === 1 ? '' : 's'}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Toggle checked={type.active !== false} label={`${type.title} active`} onChange={(active) => setActive(type, active)} />
                  <button type="button" onClick={() => copyLink(type)} aria-label={`Copy link for ${type.title}`} className="btn btn-ghost !p-2"><Copy size={16} /></button>
                  <button type="button" onClick={() => setEditingId(type.id)} aria-label={`Edit ${type.title}`} className="btn btn-ghost !p-2"><Pencil size={16} /></button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {activeCount === 0 && (
        <p className="text-sm font-medium text-danger mt-4">No meeting types are active, so nobody can book you right now.</p>
      )}
    </section>
  );
}
