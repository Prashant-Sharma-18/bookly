import React, { useEffect, useState } from 'react';
import { CalendarPlus, CalendarX2, CheckCircle2, Download, Globe, Hourglass, Link2, Loader2, Video, XCircle } from 'lucide-react';
import { ADMIN_EMAIL, getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { sendEmail } from './email.js';
import {
  buildIcsFile,
  emailTemplates,
  formatDisplayDate,
  formatInVisitorTime,
  getGoogleCalendarUrl,
  getOutlookCalendarUrl,
  getSlotId,
  getSlotStartMs,
  getTimeLabel,
  HOST_NAME,
  MEETING_TITLE,
  parseDateKey,
  TIME_ZONE_LABEL,
  visitorIsInHostTimeZone
} from './booking.js';
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
      const slotRef = services.doc(services.db, 'slots', getSlotId(booking.date, booking.time));
      const now = new Date().toISOString();

      // The rules only accept this when all three writes agree, and only for whoever holds the token.
      await services.runTransaction(services.db, async (transaction) => {
        const current = await transaction.get(manageRef);
        const slot = await transaction.get(slotRef);
        if (!['pending', 'confirmed'].includes(current.data()?.status)) throw new Error('NOT_CANCELLABLE');

        transaction.update(manageRef, { status: 'cancelled', cancelledAt: now });
        transaction.update(bookingRef, { status: 'cancelled', cancelledBy: 'booker', decidedAt: now });
        // An expired hold may already belong to someone else; only free it if it's still ours.
        if (slot.exists() && slot.data().bookingId === booking.bookingId) {
          transaction.delete(slotRef);
        }
      });

      await Promise.all([
        ADMIN_EMAIL ? sendEmail({ toEmail: ADMIN_EMAIL, ...emailTemplates.hostBookerCancelled(booking), replyTo: booking.email }) : null,
        sendEmail({
          toEmail: booking.email,
          subject: `You cancelled: ${MEETING_TITLE} on ${formatDisplayDate(parseDateKey(booking.date), true)}`,
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

  const downloadIcs = () => {
    const blob = new Blob([buildIcsFile(booking, booking.bookingId)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meeting.ics';
    link.click();
    URL.revokeObjectURL(url);
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
              <p className="font-semibold text-ink">{MEETING_TITLE}</p>
              <p className="text-sm text-ink-2">with {HOST_NAME}</p>
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
                <button onClick={downloadIcs} className="btn btn-outline"><Download size={16} /> Apple / .ics</button>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <a href="#" className="btn btn-ghost -ml-3">Book another time</a>
            {canCancel && (
              <button onClick={cancelBooking} disabled={isCancelling} className="btn btn-ghost !text-danger hover:!bg-danger-soft">
                {isCancelling ? <Loader2 size={16} className="animate-spin" /> : <CalendarX2 size={16} />} Cancel booking
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-ink-3 mt-6">Keep this link private. Anyone with it can cancel this booking.</p>
    </Shell>
  );
}
