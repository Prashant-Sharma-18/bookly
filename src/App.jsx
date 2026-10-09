/* global __app_id */
import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Video,
  Calendar as CalendarIcon,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Hourglass,
  Loader2
} from 'lucide-react';
import { ADMIN_EMAIL, getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { sendEmail } from './email.js';
import {
  createManageToken,
  DEFAULT_AVAILABILITY,
  emailTemplates,
  formatDateKey,
  formatDisplayDate,
  formatInVisitorTime,
  getAvailableTimes,
  getHostTodayKey,
  getManageUrl,
  getSlotId,
  getTimeLabel,
  HOST_NAME,
  isSlotHeld,
  MAX_DAYS_AHEAD,
  MEETING_TITLE,
  normalizeAvailability,
  PENDING_EXPIRY_HOURS,
  TIME_ZONE_LABEL,
  visitorIsInHostTimeZone
} from './booking.js';
import { Avatar, Banner, Logo } from './ui.jsx';

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const LOCAL_STORAGE_KEY = `bookly:${appId}:appointments`;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

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

export default function App() {
  // Taken slots ({ date, time }). With Firebase these come from the public `slots` collection,
  // which holds no personal details; the bookings themselves are only readable by the host.
  const [appointments, setAppointments] = useState([]);
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY);
  const [blocks, setBlocks] = useState([]); // busy times: manual blocks + Google Calendar sync
  const [dataLoading, setDataLoading] = useState(true);
  const [manageToken, setManageToken] = useState('');

  // App State: 0 = Calendar/Time Selection, 1 = Form, 2 = Success
  const [step, setStep] = useState(0);

  // Selection State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Form State
  const [formData, setFormData] = useState({ name: '', email: '', notes: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    document.title = step === 2
      ? 'Request sent · Bookly'
      : `${MEETING_TITLE} with ${HOST_NAME} · Bookly`;
  }, [step]);

  // Firebase Data Sync
  useEffect(() => {
    if (!hasFirebaseConfig) {
      setAppointments(loadLocalAppointments());
      setDataLoading(false);
      return;
    }

    let unsubscribeSlots = () => {};
    let unsubscribeAvailability = () => {};
    let unsubscribeBlocks = () => {};
    let isMounted = true;

    getFirebaseServices()
      .then((services) => {
        if (!isMounted) return;

        // The host's working hours, days off, buffer and daily limit (admin Settings tab).
        unsubscribeAvailability = services.onSnapshot(
          services.doc(services.db, 'config', 'availability'),
          (snapshot) => setAvailability(normalizeAvailability(snapshot.data())),
          (error) => console.error("Firestore Error:", error)
        );

        unsubscribeBlocks = services.onSnapshot(
          services.collection(services.db, 'blocks'),
          (snapshot) => setBlocks(snapshot.docs.map(snapshotDoc => snapshotDoc.data())),
          (error) => console.error("Firestore Error:", error)
        );

        unsubscribeSlots = services.onSnapshot(
          services.collection(services.db, 'slots'),
          (snapshot) => {
            setAppointments(snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
            setErrorMessage('');
            setDataLoading(false);
          },
          (error) => {
            console.error("Firestore Error:", error);
            setErrorMessage('Unable to load availability. Please refresh and try again.');
            setDataLoading(false);
          }
        );
      })
      .catch((error) => {
        console.error("Firestore Setup Error:", error);
        if (!isMounted) return;
        setErrorMessage('Unable to load availability. Please refresh and try again.');
        setDataLoading(false);
      });

    return () => {
      isMounted = false;
      unsubscribeSlots();
      unsubscribeAvailability();
      unsubscribeBlocks();
    };
  }, []);

  const handleDateSelect = (day) => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    setSelectedDate(newDate);
    setSelectedTimeSlot(null); // Reset time when date changes
    setErrorMessage('');
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleTimeSelect = (slotId) => {
    setSelectedTimeSlot(slotId);
    setErrorMessage('');
  };

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

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const dateString = formatDateKey(selectedDate);
      const slotId = getSlotId(dateString, selectedTimeSlot);
      // Re-check: the form may have sat open while the slot was taken, fell inside the notice window,
      // or the host changed their hours.
      if (!getAvailableTimes(dateString, availability, appointments, blocks).includes(selectedTimeSlot)) {
        throw new Error('SLOT_ALREADY_BOOKED');
      }

      const token = createManageToken();
      const booking = {
        date: dateString,
        time: selectedTimeSlot,
        name: trimmedFormData.name,
        email: trimmedFormData.email,
        notes: trimmedFormData.notes,
        status: 'pending',
        manageId: token,
        createdAt: new Date().toISOString()
      };

      if (hasFirebaseConfig) {
        const services = await getFirebaseServices();
        const slotRef = services.doc(services.db, 'slots', slotId);
        const bookingRef = services.doc(services.collection(services.db, 'bookings'));
        const manageRef = services.doc(services.db, 'manage', token);

        // The slot doc acts as a lock so two people can't request the same time.
        // A pending hold older than PENDING_EXPIRY_HOURS can be taken over.
        await services.runTransaction(services.db, async (transaction) => {
          const existingSlot = await transaction.get(slotRef);

          if (existingSlot.exists() && isSlotHeld(existingSlot.data())) {
            throw new Error('SLOT_ALREADY_BOOKED');
          }

          transaction.set(bookingRef, booking);
          // The booker's view of their booking, readable only by whoever holds the secret token.
          transaction.set(manageRef, {
            bookingId: bookingRef.id,
            date: dateString,
            time: selectedTimeSlot,
            name: booking.name,
            email: booking.email,
            status: 'pending',
            meetingLink: '',
            createdAt: booking.createdAt
          });
          transaction.set(slotRef, {
            date: dateString,
            time: selectedTimeSlot,
            bookingId: bookingRef.id,
            confirmed: false,
            createdAt: services.serverTimestamp()
          });
        });
      } else {
        const nextAppointments = [...appointments, { id: slotId, ...booking }];

        saveLocalAppointments(nextAppointments);
        setAppointments(nextAppointments);
      }

      const adminUrl = `${window.location.origin}${window.location.pathname}#admin`;
      const [bookerEmailSent] = await Promise.all([
        sendEmail({ toEmail: booking.email, ...emailTemplates.requestReceived(booking), replyTo: ADMIN_EMAIL }),
        ADMIN_EMAIL
          ? sendEmail({ toEmail: ADMIN_EMAIL, ...emailTemplates.hostNewRequest(booking, adminUrl), replyTo: booking.email })
          : Promise.resolve(false)
      ]);

      setSubmittedEmail(booking.email);
      setEmailSent(bookerEmailSent);
      setManageToken(hasFirebaseConfig ? token : '');
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
    setErrorMessage('');
    setSubmittedEmail('');
    setEmailSent(false);
    setManageToken('');
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const days = [];
    // Padding for first day
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} aria-hidden="true" />);
    }

    const now = Date.now();
    const hostTodayKey = getHostTodayKey(now);
    const thisMonth = new Date();
    const canGoBack = year > thisMonth.getFullYear() || (year === thisMonth.getFullYear() && month > thisMonth.getMonth());
    const canGoForward = new Date(year, month + 1, 1).getTime() <= now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;

    for (let day = 1; day <= daysInMonth; day++) {
      const iterDate = new Date(year, month, day);
      const dateKey = formatDateKey(iterDate);
      // Selectable only when the host's hours leave at least one open time (also covers past days,
      // days off, the booking window, full days and the notice period).
      const isSelectable = dateKey >= hostTodayKey
        && getAvailableTimes(dateKey, availability, appointments, blocks, now).length > 0;
      const isToday = dateKey === hostTodayKey;

      const isSelected = selectedDate &&
                         selectedDate.getDate() === day &&
                         selectedDate.getMonth() === month &&
                         selectedDate.getFullYear() === year;

      days.push(
        <button
          key={`day-${day}`}
          onClick={() => isSelectable && handleDateSelect(day)}
          disabled={!isSelectable}
          aria-pressed={Boolean(isSelected)}
          aria-label={`${formatDisplayDate(iterDate)}${isSelectable ? '' : ', unavailable'}`}
          className={`relative mx-auto size-10 sm:size-11 rounded-full grid place-items-center text-sm transition-all duration-150
            ${isSelected
              ? 'bg-brand text-on-brand font-semibold shadow-[var(--shadow-pop)] scale-105'
              : isSelectable
                ? 'bg-brand-soft text-brand-ink font-semibold hover:bg-brand hover:text-on-brand cursor-pointer'
                : 'text-ink-3/60 cursor-not-allowed'}
          `}
        >
          {day}
          {isToday && (
            <span className={`absolute bottom-1 size-1 rounded-full ${isSelected ? 'bg-white' : 'bg-brand'}`} />
          )}
        </button>
      );
    }

    return (
      <div className="min-w-0">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-ink">
            {MONTH_NAMES[month]} <span className="text-ink-3 font-normal">{year}</span>
          </h3>
          <div className="flex gap-1">
            <button onClick={handlePrevMonth} disabled={!canGoBack} aria-label="Previous month" className="btn btn-ghost !p-2">
              <ChevronLeft size={18} />
            </button>
            <button onClick={handleNextMonth} disabled={!canGoForward} aria-label="Next month" className="btn btn-ghost !p-2">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-y-2 text-center mb-2">
          {DAY_NAMES.map(day => (
            <div key={day} className="text-[11px] font-semibold text-ink-3 tracking-widest">
              {day}
            </div>
          ))}
        </div>
        <div key={`${year}-${month}`} className="grid grid-cols-7 gap-y-1.5 animate-rise">
          {days}
        </div>
      </div>
    );
  };

  const renderTimeSlots = () => {
    if (!selectedDate) {
      return (
        <div className="hidden lg:flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-line p-6 text-ink-3">
          <CalendarDays size={28} className="mb-3" />
          <p className="text-sm">Pick a highlighted day to see open times.</p>
        </div>
      );
    }

    const dateString = formatDateKey(selectedDate);

    const availableSlots = getAvailableTimes(dateString, availability, appointments, blocks)
      .map(time => ({ id: time, label: getTimeLabel(time) }));
    const showVisitorTime = !visitorIsInHostTimeZone();

    return (
      <div key={dateString} className="min-w-0 animate-rise">
        <h3 className="text-base font-semibold text-ink">{formatDisplayDate(selectedDate)}</h3>
        <p className="text-xs text-ink-3 mt-0.5 mb-4">Times in {TIME_ZONE_LABEL}</p>
        <div className="flex flex-col gap-2 lg:max-h-[380px] lg:overflow-y-auto lg:pr-1 -mr-1">
          {availableSlots.map(slot => {
            const isSelected = selectedTimeSlot === slot.id;

            return (
              <div key={slot.id} className="flex gap-2">
                <button
                  onClick={() => handleTimeSelect(slot.id)}
                  aria-pressed={isSelected}
                  className={`min-h-12 rounded-xl border text-sm font-semibold transition-all duration-200
                    ${isSelected
                      ? 'flex-1 bg-ink text-surface border-ink'
                      : 'w-full bg-surface border-line text-ink hover:border-brand hover:text-brand'}
                  `}
                >
                  {slot.label}
                  {showVisitorTime && (
                    <span className={`block text-[11px] font-normal ${isSelected ? 'opacity-70' : 'text-ink-3'}`}>
                      {formatInVisitorTime(dateString, slot.id)} your time
                    </span>
                  )}
                </button>
                {isSelected && (
                  <button onClick={proceedToForm} className="btn btn-primary flex-1 !rounded-xl animate-rise">
                    Next <ArrowRight size={16} />
                  </button>
                )}
              </div>
            );
          })}
          {availableSlots.length === 0 && (
            <p className="text-ink-3 text-sm rounded-xl bg-muted px-4 py-6 text-center">No open times on this day.</p>
          )}
        </div>
      </div>
    );
  };

  const renderPicker = () => (
    <div className="p-6 sm:p-8">
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">Pick a date & time</h2>
      <p className="text-sm text-ink-2 mt-1 mb-6">Highlighted days have open times.</p>
      {errorMessage && <Banner className="mb-6">{errorMessage}</Banner>}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
        {renderCalendar()}
        {renderTimeSlots()}
      </div>
    </div>
  );

  const renderForm = () => (
    <div className="p-6 sm:p-8 animate-rise">
      <button onClick={() => setStep(0)} className="btn btn-ghost -ml-3 mb-4">
        <ArrowLeft size={16} /> Back
      </button>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">Your details</h2>
      <p className="text-sm text-ink-2 mt-1 mb-6">We'll email you as soon as {HOST_NAME} responds.</p>
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
            {isSubmitting ? 'Sending request…' : 'Request booking'}
          </button>
          <p className="text-xs text-ink-3 mt-3">
            Your time is held for {PENDING_EXPIRY_HOURS} hours while {HOST_NAME} confirms.
          </p>
        </div>
      </form>
    </div>
  );

  const renderSuccess = () => {
    const nextSteps = [
      { title: 'Request sent', detail: emailSent ? `A copy is in ${submittedEmail}.` : `We'll write to ${submittedEmail}.`, done: true },
      { title: `${HOST_NAME} reviews it`, detail: `Usually well within ${PENDING_EXPIRY_HOURS} hours.`, done: false },
      { title: 'You get a confirmation', detail: 'With the meeting link and time.', done: false }
    ];

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

        <ol className="mt-8 w-full max-w-sm text-left animate-rise">
          {nextSteps.map((item, index) => (
            <li key={item.title} className="relative flex gap-4 pb-6 last:pb-0">
              {index < nextSteps.length - 1 && (
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
          <p className="text-xs text-ink-3 mt-3 max-w-xs">The link is also in your email. Use it to check the status or cancel.</p>
        )}
      </div>
    );
  };

  const steps = ['Choose a time', 'Your details', 'Done'];
  const selectedSlotLabel = selectedTimeSlot ? getTimeLabel(selectedTimeSlot) : '';

  const renderSidebar = () => (
    <aside className="p-6 sm:p-8 border-b md:border-b-0 md:border-r border-line flex flex-col gap-6 bg-muted/40">
      <div>
        <div className="flex items-center gap-3 mb-5">
          <Avatar name={HOST_NAME} size="size-12" className="text-lg ring-4 ring-surface" />
          <div>
            <p className="text-sm text-ink-2">{HOST_NAME}</p>
            <p className="text-xs text-ink-3">Host</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{MEETING_TITLE}</h1>
      </div>

      <ul className="space-y-3 text-sm text-ink-2">
        {[
          { Icon: Clock, text: '30 min' },
          { Icon: Video, text: 'Video call, link sent on confirmation' },
          { Icon: Globe, text: TIME_ZONE_LABEL }
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 sm:px-6 pt-6">
        <Logo />
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
        {dataLoading ? (
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
        ) : (
          <div className="card grid md:grid-cols-[300px_minmax(0,1fr)] overflow-hidden animate-rise">
            {renderSidebar()}
            <section className="min-w-0">
              {step === 0 && renderPicker()}
              {step === 1 && renderForm()}
              {step === 2 && renderSuccess()}
            </section>
          </div>
        )}
      </main>

      <footer className="pb-6 text-center text-xs text-ink-3">
        Scheduling by <span className="font-semibold text-ink-2">Bookly</span>
      </footer>
    </div>
  );
}
