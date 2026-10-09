/* global __app_id */
import React, { useState, useEffect } from 'react';
import {
  Clock,
  Globe,
  Video,
  Calendar as CalendarIcon,
  ArrowLeft,
  ArrowRight,
  CalendarX2,
  Check,
  CheckCircle2,
  Download,
  Hourglass,
  Loader2,
  Zap
} from 'lucide-react';
import { ADMIN_EMAIL, getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { sendEmail } from './email.js';
import {
  collectAnswers,
  createManageToken,
  DEFAULT_EVENT_TYPE,
  downloadIcsFile,
  emailTemplates,
  formatDateKey,
  formatDisplayDate,
  formatDuration,
  formatInVisitorTime,
  getAvailableTimes,
  getCellTimes,
  getGoogleCalendarUrl,
  getManageUrl,
  getOutlookCalendarUrl,
  getSlotId,
  getTimeLabel,
  HOST_NAME,
  isSlotHeld,
  PENDING_EXPIRY_HOURS,
  sortEventTypes,
  TIME_ZONE_LABEL,
  visitorIsInHostTimeZone
} from './booking.js';
import SlotPicker from './SlotPicker.jsx';
import useBookingData from './useBookingData.js';
import { Avatar, Banner, Logo } from './ui.jsx';

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const LOCAL_STORAGE_KEY = `bookly:${appId}:appointments`;

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const loadLocalAppointments = () => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
  } catch (error) {
    console.error('Unable to read local appointments:', error);
    return [];
  }
};

const saveLocalAppointments = (appointments) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appointments));
};

// One input for a host-defined question (Settings > Meeting types > Questions).
function QuestionField({ question, value, onChange }) {
  const id = `q-${question.id}`;
  const label = (
    <label htmlFor={id} className="block text-sm font-medium text-ink mb-1.5">
      {question.label} {!question.required && <span className="text-ink-3 font-normal">Optional</span>}
    </label>
  );

  if (question.kind === 'choice') {
    return (
      <div>
        {label}
        <select id={id} required={question.required} value={value} onChange={(e) => onChange(e.target.value)} className="field">
          <option value="">Choose…</option>
          {question.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    );
  }

  if (question.kind === 'long') {
    return (
      <div>
        {label}
        <textarea id={id} rows={3} required={question.required} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} className="field resize-none" />
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        id={id}
        type={question.kind === 'phone' ? 'tel' : 'text'}
        autoComplete={question.kind === 'phone' ? 'tel' : 'off'}
        required={question.required}
        maxLength={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </div>
  );
}

// `typeSlug` comes from the #book/<slug> route. Without it, the page shows the only active
// meeting type directly, or a picker when there are several.
export default function App({ typeSlug }) {
  const {
    cells: appointments, setCells: setAppointments, availability, blocks, eventTypes, loading: dataLoading, error: loadError
  } = useBookingData({ localCells: hasFirebaseConfig ? null : loadLocalAppointments() });
  const [manageToken, setManageToken] = useState('');
  const [bookedResult, setBookedResult] = useState(null); // { booking, bookingId } after submitting

  // App State: 0 = Calendar/Time Selection, 1 = Form, 2 = Success
  const [step, setStep] = useState(0);

  // Selection State
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Form State
  const [formData, setFormData] = useState({ name: '', email: '', notes: '' });
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const activeTypes = sortEventTypes((eventTypes || []).filter(type => type.active !== false));
  const eventType = typeSlug
    ? activeTypes.find(type => type.id === typeSlug)
    : (activeTypes.length === 1 ? activeTypes[0] : undefined);
  const showTypePicker = !typeSlug && activeTypes.length > 1;
  const duration = eventType?.duration ?? DEFAULT_EVENT_TYPE.duration;
  const isAutoConfirm = Boolean(eventType?.autoConfirm);
  const questions = eventType?.questions || [];

  useEffect(() => {
    document.title = step === 2
      ? `${isAutoConfirm ? 'Booked' : 'Request sent'} · Bookly`
      : `${eventType ? eventType.title : 'Book a meeting'} with ${HOST_NAME} · Bookly`;
  }, [step, eventType, isAutoConfirm]);

  const proceedToForm = () => {
    if (selectedDate && selectedTimeSlot) {
      setStep(1);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    const trimmedFormData = {
      name: formData.name.trim(),
      email: formData.email.trim(),
      notes: formData.notes.trim()
    };

    if (!selectedDate || !selectedTimeSlot) {
      setErrorMessage('Please choose a date and time before scheduling.');
      setStep(0);
      return;
    }

    if (!trimmedFormData.name || !isValidEmail(trimmedFormData.email)) {
      setErrorMessage('Please enter your name and a valid email address.');
      return;
    }

    const missing = questions.find(question => question.required && !(answers[question.id] || '').trim());
    if (missing) {
      setErrorMessage(`Please answer "${missing.label}".`);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const dateString = formatDateKey(selectedDate);
      // Re-check: the form may have sat open while the slot was taken, fell inside the notice window,
      // or the host changed their hours.
      if (!getAvailableTimes(dateString, availability, appointments, blocks, duration).includes(selectedTimeSlot)) {
        throw new Error('SLOT_ALREADY_BOOKED');
      }

      const token = createManageToken();
      const cellTimes = getCellTimes(selectedTimeSlot, duration);
      const bookingAnswers = collectAnswers(questions, answers);
      const booking = {
        date: dateString,
        time: selectedTimeSlot,
        name: trimmedFormData.name,
        email: trimmedFormData.email,
        notes: trimmedFormData.notes,
        status: isAutoConfirm ? 'confirmed' : 'pending',
        typeId: eventType.id,
        typeTitle: eventType.title,
        duration,
        meetingLink: eventType.meetingLink || '',
        ...(bookingAnswers.length ? { answers: bookingAnswers } : {}),
        manageId: token,
        createdAt: new Date().toISOString()
      };
      let bookingId;

      if (hasFirebaseConfig) {
        const services = await getFirebaseServices();
        const bookingRef = services.doc(services.collection(services.db, 'bookings'));
        const manageRef = services.doc(services.db, 'manage', token);
        const cellRefs = cellTimes.map(time => services.doc(services.db, 'slots', getSlotId(dateString, time)));
        bookingId = bookingRef.id;

        // Each half-hour cell doc is a lock, so two bookings can't overlap.
        // A pending hold older than PENDING_EXPIRY_HOURS can be taken over.
        await services.runTransaction(services.db, async (transaction) => {
          const existingCells = await Promise.all(cellRefs.map(ref => transaction.get(ref)));

          if (existingCells.some(cell => cell.exists() && isSlotHeld(cell.data()))) {
            throw new Error('SLOT_ALREADY_BOOKED');
          }

          transaction.set(bookingRef, booking);
          // The booker's view of their booking, readable only by whoever holds the secret token.
          transaction.set(manageRef, {
            bookingId,
            date: dateString,
            time: selectedTimeSlot,
            name: booking.name,
            email: booking.email,
            status: booking.status,
            typeId: booking.typeId,
            typeTitle: booking.typeTitle,
            duration,
            meetingLink: booking.meetingLink,
            createdAt: booking.createdAt
          });
          cellRefs.forEach((ref, index) => transaction.set(ref, {
            date: dateString,
            time: cellTimes[index],
            bookingId,
            confirmed: isAutoConfirm,
            createdAt: services.serverTimestamp()
          }));
        });
      } else {
        bookingId = getSlotId(dateString, selectedTimeSlot);
        const nextAppointments = [
          ...appointments,
          ...cellTimes.map(time => ({ id: getSlotId(dateString, time), ...booking, time, bookingId }))
        ];

        saveLocalAppointments(nextAppointments);
        setAppointments(nextAppointments);
      }

      const [bookerEmailSent] = await Promise.all([
        sendEmail({
          toEmail: booking.email,
          ...(isAutoConfirm ? emailTemplates.confirmed(booking) : emailTemplates.requestReceived(booking)),
          replyTo: ADMIN_EMAIL
        }),
        ADMIN_EMAIL
          ? sendEmail({
            toEmail: ADMIN_EMAIL,
            ...(isAutoConfirm ? emailTemplates.hostNewBooking(booking, bookingId) : emailTemplates.hostNewRequest(booking, bookingId)),
            replyTo: booking.email
          })
          : Promise.resolve(false)
      ]);

      setSubmittedEmail(booking.email);
      setEmailSent(bookerEmailSent);
      setManageToken(hasFirebaseConfig ? token : '');
      setBookedResult({ booking, bookingId });
      setStep(2);
    } catch (error) {
      console.error("Error booking appointment:", error);
      setErrorMessage(
        error.message === 'SLOT_ALREADY_BOOKED'
          ? 'That time was just booked. Please choose another slot.'
          : 'Unable to schedule the event. Please try again.'
      );

      if (error.message === 'SLOT_ALREADY_BOOKED') {
        setStep(0);
        setSelectedTimeSlot(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep(0);
    setSelectedDate(null);
    setSelectedTimeSlot(null);
    setFormData({ name: '', email: '', notes: '' });
    setAnswers({});
    setErrorMessage('');
    setSubmittedEmail('');
    setEmailSent(false);
    setManageToken('');
    setBookedResult(null);
  };

  const shownError = errorMessage || loadError;

  const renderPicker = () => (
    <div className="p-6 sm:p-8">
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">Pick a date & time</h2>
      <p className="text-sm text-ink-2 mt-1 mb-6">Highlighted days have open times.</p>
      {shownError && <Banner className="mb-6">{shownError}</Banner>}
      <SlotPicker
        availability={availability}
        cells={appointments}
        blocks={blocks}
        duration={duration}
        selectedDate={selectedDate}
        selectedTime={selectedTimeSlot}
        onSelectDate={(date) => { setSelectedDate(date); setSelectedTimeSlot(null); setErrorMessage(''); }}
        onSelectTime={(time) => { setSelectedTimeSlot(time); setErrorMessage(''); }}
        onNext={proceedToForm}
      />
    </div>
  );

  const renderForm = () => (
    <div className="p-6 sm:p-8 animate-rise">
      <button onClick={() => setStep(0)} className="btn btn-ghost -ml-3 mb-4">
        <ArrowLeft size={16} /> Back
      </button>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">Your details</h2>
      <p className="text-sm text-ink-2 mt-1 mb-6">
        {isAutoConfirm ? "We'll email your confirmation right away." : `We'll email you as soon as ${HOST_NAME} responds.`}
      </p>
      {errorMessage && <Banner className="mb-6">{errorMessage}</Banner>}

      <form onSubmit={handleFormSubmit} className="space-y-5 max-w-md">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink mb-1.5">Name</label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Jane Cooper"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="jane@company.com"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            className="field"
          />
        </div>
        {questions.map(question => (
          <QuestionField
            key={question.id}
            question={question}
            value={answers[question.id] || ''}
            onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
          />
        ))}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-ink mb-1.5">
            Anything to prepare? <span className="text-ink-3 font-normal">Optional</span>
          </label>
          <textarea
            id="notes"
            rows={4}
            placeholder="Share context, links or questions for the meeting."
            value={formData.notes}
            onChange={(e) => setFormData({...formData, notes: e.target.value})}
            className="field resize-none"
          />
        </div>
        <div className="pt-1">
          <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full sm:w-auto px-7 py-3">
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {isSubmitting
              ? (isAutoConfirm ? 'Booking…' : 'Sending request…')
              : (isAutoConfirm ? 'Confirm booking' : 'Request booking')}
          </button>
          <p className="text-xs text-ink-3 mt-3">
            {isAutoConfirm
              ? 'This meeting type is confirmed instantly.'
              : `Your time is held for ${PENDING_EXPIRY_HOURS} hours while ${HOST_NAME} confirms.`}
          </p>
        </div>
      </form>
    </div>
  );

  const renderNextSteps = (items) => (
    <ol className="mt-8 w-full max-w-sm text-left animate-rise">
      {items.map((item, index) => (
        <li key={item.title} className="relative flex gap-4 pb-6 last:pb-0">
          {index < items.length - 1 && (
            <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" aria-hidden="true" />
          )}
          <span className={`relative size-7 shrink-0 rounded-full grid place-items-center text-xs font-semibold
            ${item.done ? 'bg-success text-on-brand' : 'bg-muted text-ink-3 border border-line'}`}>
            {item.done ? <Check size={14} strokeWidth={3} /> : index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{item.title}</p>
            <p className="text-sm text-ink-2 break-all">{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );

  const renderSuccessActions = () => (
    <>
      <div className="mt-10 flex flex-col sm:flex-row gap-3">
        {manageToken && (
          <a href={getManageUrl(manageToken)} className="btn btn-primary">
            View my booking <ArrowRight size={16} />
          </a>
        )}
        <button onClick={resetFlow} className="btn btn-outline">
          Book another time
        </button>
      </div>
      {manageToken && (
        <p className="text-xs text-ink-3 mt-3 max-w-xs">The link is also in your email. Use it to check the details, change the time or cancel.</p>
      )}
    </>
  );

  const renderSuccess = () => {
    if (bookedResult?.booking.status === 'confirmed') {
      const { booking, bookingId } = bookedResult;
      return (
        <div className="p-6 sm:p-10 flex flex-col items-center text-center">
          <div className="relative mb-6 animate-pop">
            <div className="absolute inset-0 rounded-full bg-success-soft blur-xl scale-150" aria-hidden="true" />
            <div className="relative size-16 rounded-full bg-success-soft grid place-items-center ring-8 ring-success-soft/40">
              <CheckCircle2 size={30} className="text-success" />
            </div>
          </div>
          <span className="pill bg-success-soft text-success mb-3 animate-rise">Confirmed</span>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink animate-rise">You're booked</h2>
          <p className="text-ink-2 mt-2 max-w-md animate-rise">
            {emailSent ? `The details are on their way to ${submittedEmail}.` : `Save the details below; we couldn't email ${submittedEmail}.`}
          </p>
          {booking.meetingLink && (
            <a href={booking.meetingLink} target="_blank" rel="noreferrer" className="mt-4 text-sm text-brand hover:underline break-all animate-rise">
              {booking.meetingLink}
            </a>
          )}

          <div className="mt-8 w-full max-w-sm animate-rise">
            <p className="text-sm font-medium text-ink mb-2">Add to calendar</p>
            <div className="grid grid-cols-3 gap-2">
              <a href={getGoogleCalendarUrl(booking)} target="_blank" rel="noreferrer" className="btn btn-outline !px-3">Google</a>
              <a href={getOutlookCalendarUrl(booking)} target="_blank" rel="noreferrer" className="btn btn-outline !px-3">Outlook</a>
              <button onClick={() => downloadIcsFile(booking, bookingId)} className="btn btn-outline !px-3"><Download size={16} /> .ics</button>
            </div>
          </div>

          {renderSuccessActions()}
        </div>
      );
    }

    return (
      <div className="p-6 sm:p-10 flex flex-col items-center text-center">
        <div className="relative mb-6 animate-pop">
          <div className="absolute inset-0 rounded-full bg-warn-soft blur-xl scale-150" aria-hidden="true" />
          <div className="relative size-16 rounded-full bg-warn-soft grid place-items-center ring-8 ring-warn-soft/40">
            <Hourglass size={28} className="text-warn" />
          </div>
        </div>
        <span className="pill bg-warn-soft text-warn mb-3 animate-rise">Pending confirmation</span>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink animate-rise">Request sent</h2>
        <p className="text-ink-2 mt-2 max-w-md animate-rise">
          Your time is reserved. You'll get an email once {HOST_NAME} confirms or declines.
        </p>

        {renderNextSteps([
          { title: 'Request sent', detail: emailSent ? `A copy is in ${submittedEmail}.` : `We'll write to ${submittedEmail}.`, done: true },
          { title: `${HOST_NAME} reviews it`, detail: `Usually well within ${PENDING_EXPIRY_HOURS} hours.`, done: false },
          { title: 'You get a confirmation', detail: 'With the meeting link and time.', done: false }
        ])}

        {renderSuccessActions()}
      </div>
    );
  };

  const steps = ['Choose a time', 'Your details', 'Done'];
  const selectedSlotLabel = selectedTimeSlot ? getTimeLabel(selectedTimeSlot) : '';

  const renderHostHeader = () => (
    <div className="flex items-center gap-3">
      <Avatar name={HOST_NAME} size="size-12" className="text-lg ring-4 ring-surface" />
      <div>
        <p className="text-sm text-ink-2">{HOST_NAME}</p>
        <p className="text-xs text-ink-3">Host</p>
      </div>
    </div>
  );

  const renderSidebar = () => (
    <aside className="p-6 sm:p-8 border-b md:border-b-0 md:border-r border-line flex flex-col gap-6 bg-muted/40">
      <div>
        {activeTypes.length > 1 && step === 0 && (
          <a href="#" className="btn btn-ghost -ml-3 -mt-2 mb-3 text-sm"><ArrowLeft size={16} /> All meeting types</a>
        )}
        <div className="mb-5">{renderHostHeader()}</div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{eventType.title}</h1>
        {eventType.description && <p className="text-sm text-ink-2 mt-2 whitespace-pre-line">{eventType.description}</p>}
      </div>

      <ul className="space-y-3 text-sm text-ink-2">
        {[
          { Icon: Clock, text: formatDuration(duration) },
          { Icon: Video, text: isAutoConfirm ? 'Video call, link sent with your confirmation' : 'Video call, link sent on confirmation' },
          { Icon: Globe, text: TIME_ZONE_LABEL },
          ...(isAutoConfirm ? [{ Icon: Zap, text: 'Confirmed instantly' }] : [])
        ].map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="size-8 rounded-lg bg-surface border border-line grid place-items-center shrink-0">
              <Icon size={16} className="text-ink-2" />
            </span>
            {text}
          </li>
        ))}
      </ul>

      {step >= 1 && selectedDate && selectedTimeSlot && (
        <div className="rounded-2xl bg-brand-soft p-4 animate-rise">
          <div className="flex items-start gap-3">
            <CalendarIcon size={18} className="text-brand-ink mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-brand-ink">{selectedSlotLabel}, {formatDisplayDate(selectedDate, true)}</p>
              {!visitorIsInHostTimeZone() && (
                <p className="text-brand-ink/80 mt-0.5">{formatInVisitorTime(formatDateKey(selectedDate), selectedTimeSlot)} your time</p>
              )}
            </div>
          </div>
        </div>
      )}

      <ol className="hidden md:flex flex-col gap-3 pt-6 border-t border-line" aria-label="Progress">
        {steps.map((label, index) => (
          <li key={label} className={`flex items-center gap-3 text-sm ${index === step ? 'text-ink font-semibold' : 'text-ink-3'}`}>
            <span className={`size-6 rounded-full grid place-items-center text-[11px] font-semibold transition-colors
              ${index < step ? 'bg-success text-on-brand' : index === step ? 'bg-brand text-on-brand' : 'border border-line'}`}>
              {index < step ? <Check size={12} strokeWidth={3} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </aside>
  );

  const renderTypePicker = () => (
    <div className="card max-w-2xl mx-auto overflow-hidden animate-rise">
      <div className="p-6 sm:p-8 border-b border-line bg-muted/40">
        {renderHostHeader()}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink mt-5">Book a meeting</h1>
        <p className="text-ink-2 mt-1">Choose what you'd like to meet about.</p>
      </div>
      <ul className="divide-y divide-line">
        {activeTypes.map(type => (
          <li key={type.id}>
            <a href={`#book/${type.id}`} className="group flex items-center gap-4 p-5 sm:px-8 hover:bg-muted/60 transition-colors">
              <span className="size-11 shrink-0 rounded-xl bg-brand-soft text-brand-ink grid place-items-center text-xs font-bold">
                {type.duration < 60 ? `${type.duration}m` : `${type.duration / 60}h`}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-ink">{type.title}</span>
                {type.description && <span className="block text-sm text-ink-2 truncate">{type.description}</span>}
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="pill bg-muted text-ink-2"><Clock size={12} /> {formatDuration(type.duration)}</span>
                  {type.autoConfirm
                    ? <span className="pill bg-success-soft text-success"><Zap size={12} /> Instant confirmation</span>
                    : <span className="pill bg-muted text-ink-2">Needs approval</span>}
                </span>
              </span>
              <ArrowRight size={18} className="text-ink-3 group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );

  const renderTypeNotFound = () => (
    <div className="card max-w-md mx-auto p-8 text-center animate-rise">
      <span className="mx-auto mb-4 size-12 rounded-2xl bg-muted grid place-items-center text-ink-3"><CalendarX2 size={22} /></span>
      <h1 className="text-xl font-semibold text-ink">This meeting type isn't available</h1>
      <p className="text-sm text-ink-2 mt-1 mb-6">The link may be old, or {HOST_NAME} has turned it off.</p>
      <a href="#" className="btn btn-primary">See available meetings</a>
    </div>
  );

  const renderContent = () => {
    if (dataLoading) {
      return (
        <div className="card grid md:grid-cols-[300px_1fr] overflow-hidden" aria-busy="true" aria-label="Loading">
          <div className="p-8 space-y-4 border-b md:border-b-0 md:border-r border-line">
            <div className="skeleton size-12 !rounded-full" />
            <div className="skeleton h-7 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-4 w-2/3" />
          </div>
          <div className="p-8 space-y-4">
            <div className="skeleton h-7 w-1/3" />
            <div className="skeleton h-64 w-full" />
          </div>
        </div>
      );
    }
    if (showTypePicker) return renderTypePicker();
    if (!eventType) return renderTypeNotFound();

    return (
      <div className="card grid md:grid-cols-[300px_minmax(0,1fr)] overflow-hidden animate-rise">
        {renderSidebar()}
        <section className="min-w-0">
          {step === 0 && renderPicker()}
          {step === 1 && renderForm()}
          {step === 2 && renderSuccess()}
        </section>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 sm:px-6 pt-6">
        <Logo />
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
        {renderContent()}
      </main>

      <footer className="pb-6 text-center text-xs text-ink-3">
        Scheduling by <span className="font-semibold text-ink-2">Bookly</span>
      </footer>
    </div>
  );
}
