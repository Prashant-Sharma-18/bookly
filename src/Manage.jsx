import React, { useEffect, useState } from 'react';
import { CalendarClock, CalendarPlus, CalendarX2, CheckCircle2, Download, Globe, Hourglass, Link2, Loader2, Video, X, XCircle } from 'lucide-react';
import { ADMIN_EMAIL, getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { sendEmail } from './email.js';
import {
  DEFAULT_EVENT_TYPE,
  downloadIcsFile,
  durationOf,
  emailTemplates,
  formatDateKey,
  formatDisplayDate,
  formatDuration,
  formatInVisitorTime,
  getAvailableTimes,
  getCellIds,
  getCellTimes,
  getSlotId,
  isSlotHeld,
  getGoogleCalendarUrl,
  getOutlookCalendarUrl,
  getSlotStartMs,
  getTimeLabel,
  HOST_NAME,
  parseDateKey,
  TIME_ZONE_LABEL,
  titleOf,
  visitorIsInHostTimeZone
} from './booking.js';
import SlotPicker from './SlotPicker.jsx';
import useBookingData from './useBookingData.js';
import { Avatar, Banner, Logo } from './ui.jsx';

const STATUS = {
  pending: { label: 'Pending confirmation', Icon: Hourglass, tone: 'bg-warn-soft text-warn', text: `Waiting for ${HOST_NAME} to confirm. You'll get an email either way.` },
  confirmed: { label: 'Confirmed', Icon: CheckCircle2, tone: 'bg-success-soft text-success', text: "You're all set. Add it to your calendar so you don't miss it." },
  declined: { label: 'Declined', Icon: XCircle, tone: 'bg-muted text-ink-2', text: `${HOST_NAME} couldn't make this time. Please pick another one.` },
  cancelled: { label: 'Cancelled', Icon: CalendarX2, tone: 'bg-danger-soft text-danger', text: 'This booking was cancelled and the time has been released.' }
};

const Shell = ({ children }) => (
  <div className="min-h-screen flex flex-col">
    <header className="mx-auto w-full max-w-xl px-4 sm:px-6 pt-6">
      <a href="#" aria-label="Book a meeting"><Logo /></a>
    </header>
    <main className="flex-1 mx-auto w-full max-w-xl px-4 sm:px-6 py-6 sm:py-10">{children}</main>
  </div>
);

export default function Manage({ token }) {
  const [services, setServices] = useState(null);
  const [booking, setBooking] = useState(undefined); // undefined = loading, null = not found
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    document.title = `Your booking · Bookly`;
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setBooking(null);
      return;
    }

    let unsubscribe = () => {};
    let isMounted = true;

    getFirebaseServices().then((firebaseServices) => {
      if (!isMounted) return;
      setServices(firebaseServices);
      unsubscribe = firebaseServices.onSnapshot(
        firebaseServices.doc(firebaseServices.db, 'manage', token),
        (snapshot) => setBooking(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
        (error) => {
          console.error('Firestore Error:', error);
          setBooking(null);
        }
      );
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [token]);

  const cancelBooking = async () => {
    if (!window.confirm('Cancel this booking? The time will be released to others.')) return;

    setIsCancelling(true);
    setErrorMessage('');

    try {
      const manageRef = services.doc(services.db, 'manage', token);
      const bookingRef = services.doc(services.db, 'bookings', booking.bookingId);
      const cellRefs = getCellIds(booking).map(id => services.doc(services.db, 'slots', id));
      const now = new Date().toISOString();

      // The rules only accept this when the writes agree, and only for whoever holds the token.
      await services.runTransaction(services.db, async (transaction) => {
        const current = await transaction.get(manageRef);
        const cells = await Promise.all(cellRefs.map(ref => transaction.get(ref)));
        if (!['pending', 'confirmed'].includes(current.data()?.status)) throw new Error('NOT_CANCELLABLE');

        transaction.update(manageRef, { status: 'cancelled', cancelledAt: now });
        transaction.update(bookingRef, { status: 'cancelled', cancelledBy: 'booker', decidedAt: now });
        // An expired hold may already belong to someone else; only free the cells that are still ours.
        cells.forEach((cell, index) => {
          if (cell.exists() && cell.data().bookingId === booking.bookingId) transaction.delete(cellRefs[index]);
        });
      });

      await Promise.all([
        ADMIN_EMAIL ? sendEmail({ toEmail: ADMIN_EMAIL, ...emailTemplates.hostBookerCancelled(booking), replyTo: booking.email }) : null,
        sendEmail({
          toEmail: booking.email,
          subject: `You cancelled: ${titleOf(booking)} on ${formatDisplayDate(parseDateKey(booking.date), true)}`,
          message: `Hi ${booking.name},\n\nYour booking has been cancelled and ${HOST_NAME} has been notified.`,
          replyTo: ADMIN_EMAIL
        })
      ]);
      setNotice(`Cancelled. ${HOST_NAME} has been notified.`);
    } catch (error) {
      console.error('Cancel Error:', error);
      setErrorMessage(error.message === 'NOT_CANCELLABLE'
        ? 'This booking can no longer be cancelled.'
        : 'Unable to cancel right now. Please try again.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (booking === undefined) {
    return (
      <Shell>
        <div className="card p-8 space-y-4" aria-busy="true" aria-label="Loading">
          <div className="skeleton h-6 w-40" />
          <div className="skeleton h-8 w-3/4" />
          <div className="skeleton h-24 w-full" />
        </div>
      </Shell>
    );
  }

  if (booking === null) {
    return (
      <Shell>
        <div className="card p-8 text-center animate-rise">
          <span className="mx-auto mb-4 size-12 rounded-2xl bg-muted grid place-items-center text-ink-3"><CalendarX2 size={22} /></span>
          <h1 className="text-xl font-semibold text-ink">Booking not found</h1>
          <p className="text-sm text-ink-2 mt-1 mb-6">Check that you opened the full link from your email.</p>
          <a href="#" className="btn btn-primary">Book a meeting</a>
        </div>
      </Shell>
    );
  }

  const status = STATUS[booking.status] || STATUS.pending;
  const isUpcoming = getSlotStartMs(booking.date, booking.time) > Date.now();
  const canCancel = isUpcoming && ['pending', 'confirmed'].includes(booking.status);
  const showCalendar = isUpcoming && booking.status === 'confirmed';

  return (
    <Shell>
      <div className="card overflow-hidden animate-rise">
        <div className="p-6 sm:p-8">
          <span className={`pill ${status.tone}`}><status.Icon size={14} /> {status.label}</span>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink mt-4">
            Hi {booking.name.split(' ')[0]}, here's your booking
          </h1>
          <p className="text-ink-2 mt-2">{status.text}</p>
        </div>

        <div className="mx-6 sm:mx-8 rounded-2xl bg-muted/60 border border-line p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={HOST_NAME} size="size-10" className="text-sm" />
            <div>
              <p className="font-semibold text-ink">{titleOf(booking)}</p>
              <p className="text-sm text-ink-2">{formatDuration(durationOf(booking))} with {HOST_NAME}</p>
            </div>
          </div>
          <div className="space-y-2.5 text-sm text-ink-2">
            <p className="flex items-start gap-3">
              <CalendarPlus size={16} className="mt-0.5 shrink-0 text-ink-3" />
              <span>
                <span className="text-ink font-medium">{getTimeLabel(booking.time)}, {formatDisplayDate(parseDateKey(booking.date), true)}</span>
                {!visitorIsInHostTimeZone() && <span className="block">{formatInVisitorTime(booking.date, booking.time)} your time</span>}
              </span>
            </p>
            <p className="flex items-center gap-3"><Globe size={16} className="shrink-0 text-ink-3" /> {TIME_ZONE_LABEL}</p>
            {booking.status === 'confirmed' && (booking.meetingLink ? (
              <a href={booking.meetingLink} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-brand hover:underline break-all">
                <Link2 size={16} className="shrink-0" /> {booking.meetingLink}
              </a>
            ) : (
              <p className="flex items-center gap-3"><Video size={16} className="shrink-0 text-ink-3" /> Meeting link to follow</p>
            ))}
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-4">
          {notice && <Banner tone="success">{notice}</Banner>}
          {errorMessage && <Banner onDismiss={() => setErrorMessage('')}>{errorMessage}</Banner>}

          {showCalendar && (
            <div>
              <p className="text-sm font-medium text-ink mb-2">Add to calendar</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <a href={getGoogleCalendarUrl(booking)} target="_blank" rel="noreferrer" className="btn btn-outline">Google</a>
                <a href={getOutlookCalendarUrl(booking)} target="_blank" rel="noreferrer" className="btn btn-outline">Outlook</a>
                <button onClick={() => downloadIcsFile(booking, booking.bookingId)} className="btn btn-outline"><Download size={16} /> Apple / .ics</button>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <a href="#" className="btn btn-ghost -ml-3">Book another time</a>
            {canCancel && (
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button onClick={cancelBooking} disabled={isCancelling} className="btn btn-ghost !text-danger hover:!bg-danger-soft">
                  {isCancelling ? <Loader2 size={16} className="animate-spin" /> : <CalendarX2 size={16} />} Cancel booking
                </button>
                {!isRescheduling && (
                  <button onClick={() => { setIsRescheduling(true); setNotice(''); }} disabled={isCancelling} className="btn btn-primary">
                    <CalendarClock size={16} /> Change time
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isRescheduling && canCancel && (
        <Reschedule
          booking={booking}
          token={token}
          services={services}
          onClose={() => setIsRescheduling(false)}
          onMoved={(message) => { setIsRescheduling(false); setNotice(message); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
      )}
      <p className="text-center text-xs text-ink-3 mt-6">Keep this link private. Anyone with it can change or cancel this booking.</p>
    </Shell>
  );
}

// Lets the guest pick a new time for the same meeting type. Instant-confirm types stay confirmed;
// others go back to pending for the host to approve the new time.
function Reschedule({ booking, token, services, onClose, onMoved }) {
  const { cells, availability, blocks, eventTypes, loading } = useBookingData();
  const [newDate, setNewDate] = useState(null);
  const [newTime, setNewTime] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const duration = durationOf(booking);
  const type = (eventTypes || []).find(t => t.id === (booking.typeId || DEFAULT_EVENT_TYPE.id));
  const staysConfirmed = Boolean(type?.autoConfirm);
  // The guest's own cells don't block them: they can move to an overlapping time.
  const otherCells = cells.filter(cell => cell.bookingId !== booking.bookingId);

  const move = async () => {
    setIsMoving(true);
    setErrorMessage('');
    const date = formatDateKey(newDate);
    const status = staysConfirmed ? 'confirmed' : 'pending';
    const previous = { date: booking.date, time: booking.time };

    try {
      if (!getAvailableTimes(date, availability, otherCells, blocks, duration).includes(newTime)) throw new Error('SLOT_TAKEN');

      const manageRef = services.doc(services.db, 'manage', token);
      const bookingRef = services.doc(services.db, 'bookings', booking.bookingId);
      const oldIds = getCellIds(booking);
      const newIds = getCellTimes(newTime, duration).map(time => getSlotId(date, time));
      const oldRefs = oldIds.map(id => services.doc(services.db, 'slots', id));
      const newRefs = newIds.map(id => services.doc(services.db, 'slots', id));

      await services.runTransaction(services.db, async (transaction) => {
        const current = await transaction.get(manageRef);
        const oldCells = await Promise.all(oldRefs.map(ref => transaction.get(ref)));
        const newCells = await Promise.all(newRefs.map(ref => transaction.get(ref)));
        if (!['pending', 'confirmed'].includes(current.data()?.status)) throw new Error('NOT_MOVABLE');
        if (newCells.some(cell => cell.exists() && cell.data().bookingId !== booking.bookingId && isSlotHeld(cell.data()))) {
          throw new Error('SLOT_TAKEN');
        }

        const movedAt = services.serverTimestamp();
        transaction.update(bookingRef, { date, time: newTime, status, rescheduledAt: movedAt, previousDate: previous.date, previousTime: previous.time });
        transaction.update(manageRef, { date, time: newTime, status, rescheduledAt: movedAt });
        newRefs.forEach((ref, index) => transaction.set(ref, {
          date,
          time: getCellTimes(newTime, duration)[index],
          bookingId: booking.bookingId,
          confirmed: status === 'confirmed',
          createdAt: movedAt
        }));
        // Free the old cells this booking still holds, unless the new time reuses them.
        oldRefs.forEach((ref, index) => {
          if (!newIds.includes(oldIds[index]) && oldCells[index].exists() && oldCells[index].data().bookingId === booking.bookingId) {
            transaction.delete(ref);
          }
        });
      });

      const moved = { ...booking, date, time: newTime, status, manageId: token };
      await Promise.all([
        sendEmail({ toEmail: booking.email, ...emailTemplates.guestRescheduled(moved, previous), replyTo: ADMIN_EMAIL }),
        ADMIN_EMAIL ? sendEmail({ toEmail: ADMIN_EMAIL, ...emailTemplates.hostRescheduled(moved, booking.bookingId, previous), replyTo: booking.email }) : null
      ]);
      onMoved(staysConfirmed
        ? `Moved to ${getTimeLabel(newTime)}, ${formatDisplayDate(newDate, true)}. It's still confirmed.`
        : `Moved to ${getTimeLabel(newTime)}, ${formatDisplayDate(newDate, true)}. ${HOST_NAME} will confirm the new time.`);
    } catch (error) {
      console.error('Reschedule Error:', error);
      setErrorMessage(
        error.message === 'SLOT_TAKEN' ? 'That time was just taken. Please pick another.'
          : error.message === 'NOT_MOVABLE' ? 'This booking can no longer be changed.'
            : 'Unable to move the booking right now. Please try again.'
      );
      if (error.message === 'SLOT_TAKEN') setNewTime(null);
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="card mt-6 p-6 sm:p-8 animate-rise">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Pick a new time</h2>
        <button onClick={onClose} disabled={isMoving} className="btn btn-ghost !p-2" aria-label="Close"><X size={18} /></button>
      </div>
      <p className="text-sm text-ink-2 mb-6">
        {staysConfirmed ? 'Your booking stays confirmed at the new time.' : `${HOST_NAME} will be asked to confirm the new time.`}
      </p>
      {errorMessage && <Banner className="mb-6" onDismiss={() => setErrorMessage('')}>{errorMessage}</Banner>}

      {loading ? (
        <div className="skeleton h-64 w-full" aria-busy="true" />
      ) : (
        <SlotPicker
          availability={availability}
          cells={otherCells}
          blocks={blocks}
          duration={duration}
          selectedDate={newDate}
          selectedTime={newTime}
          onSelectDate={(date) => { setNewDate(date); setNewTime(null); }}
          onSelectTime={setNewTime}
          onNext={() => !isMoving && move()}
          nextLabel={isMoving ? 'Moving…' : 'Move here'}
        />
      )}
    </div>
  );
}
