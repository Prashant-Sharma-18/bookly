import React, { useEffect, useState } from 'react';
import {
  CalendarCheck,
  Check,
  Clock,
  History,
  Inbox,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Settings as SettingsIcon,
  ShieldAlert,
  X
} from 'lucide-react';
import Settings from './Settings.jsx';
import { ADMIN_EMAIL, getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { hasEmailConfig, sendEmail } from './email.js';
import { describeSyncError, requestCalendarAccess, syncGoogleCalendar } from './calendarSync.js';
import {
  durationOf,
  emailTemplates,
  formatDuration as formatMeetingLength,
  getCellIds,
  getHostTodayKey,
  getSlotExpiryMs,
  getSlotStartMs,
  getTimeLabel,
  overlapsBlock,
  parseDateKey,
  TIME_ZONE_LABEL,
  titleOf
} from './booking.js';

const RESYNC_INTERVAL_MS = 15 * 60 * 1000;
import { Avatar, Banner, GoogleIcon, Logo } from './ui.jsx';

const formatDuration = (ms) => {
  const hours = Math.floor(ms / 3600000);
  return hours >= 1 ? `${hours}h` : `${Math.max(1, Math.round(ms / 60000))}m`;
};

const STATUS_STYLES = {
  pending: 'bg-warn-soft text-warn',
  confirmed: 'bg-success-soft text-success',
  declined: 'bg-muted text-ink-2',
  cancelled: 'bg-danger-soft text-danger'
};

const TABS = [
  { id: 'pending', label: 'Needs decision', Icon: Inbox, empty: 'All caught up. New requests will appear here.' },
  { id: 'upcoming', label: 'Upcoming', Icon: CalendarCheck, empty: 'No confirmed meetings coming up.' },
  { id: 'history', label: 'History', Icon: History, empty: 'Past and declined bookings will appear here.' }
];

// Centered single-card layout for the sign-in and status screens.
const AuthShell = ({ children }) => (
  <div className="min-h-screen grid place-items-center px-4 py-10">
    <div className="card w-full max-w-sm p-8 animate-rise">
      <div className="mb-8"><Logo suffix="Admin" /></div>
      {children}
    </div>
  </div>
);

const DateTile = ({ dateKey }) => {
  const date = parseDateKey(dateKey);
  return (
    <div className="w-14 shrink-0 rounded-2xl border border-line bg-surface text-center overflow-hidden">
      <div className="bg-brand text-on-brand text-[10px] font-bold tracking-widest py-1">
        {date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
      </div>
      <div className="text-xl font-semibold text-ink leading-tight pt-1">{date.getDate()}</div>
      <div className="text-[11px] text-ink-3 pb-1.5">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
    </div>
  );
};

// `review` ({ bookingId, action }) comes from the Confirm/Decline links in the host's email.
export default function Admin({ review }) {
  const [services, setServices] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [slotsById, setSlotsById] = useState({});
  const [meetingLinks, setMeetingLinks] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [tab, setTab] = useState('pending');
  const [blocks, setBlocks] = useState([]);
  const [calendarAccess, setCalendarAccess] = useState(null); // { accessToken, expiresAt }, kept in memory only
  const [syncing, setSyncing] = useState(false);

  const isAdmin = Boolean(user?.email && ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL);

  useEffect(() => {
    if (!hasFirebaseConfig) return;

    let unsubscribeAuth = () => {};
    let isMounted = true;

    getFirebaseServices().then((firebaseServices) => {
      if (!isMounted) return;
      setServices(firebaseServices);
      unsubscribeAuth = firebaseServices.onAuthStateChanged(firebaseServices.auth, (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
      });
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!services || !isAdmin) return;

    const unsubscribeBookings = services.onSnapshot(
      services.collection(services.db, 'bookings'),
      (snapshot) => {
        const nextBookings = snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        nextBookings.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        setBookings(nextBookings);
        setBookingsLoaded(true);
      },
      (error) => {
        console.error('Firestore Error:', error);
        setErrorMessage('Unable to load bookings. Check that firestore.rules has your admin email.');
      }
    );

    // Slots tell us whether a pending request still holds its time.
    const unsubscribeSlots = services.onSnapshot(
      services.collection(services.db, 'slots'),
      (snapshot) => {
        setSlotsById(Object.fromEntries(snapshot.docs.map(snapshotDoc => [snapshotDoc.id, snapshotDoc.data()])));
      },
      (error) => console.error('Firestore Error:', error)
    );

    const unsubscribeBlocks = services.onSnapshot(
      services.collection(services.db, 'blocks'),
      (snapshot) => setBlocks(snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))),
      (error) => console.error('Firestore Error:', error)
    );

    return () => {
      unsubscribeBookings();
      unsubscribeSlots();
      unsubscribeBlocks();
    };
  }, [services, isAdmin]);

  // Pulls busy times from Google Calendar. Reuses the access token while it's valid; otherwise
  // asks Google (popup), which only works from a click.
  const syncCalendar = async ({ interactive = true } = {}) => {
    setSyncing(true);
    try {
      let access = calendarAccess && calendarAccess.expiresAt > Date.now() ? calendarAccess : null;
      if (!access) {
        if (!interactive) return;
        access = await requestCalendarAccess(services, user.email);
        setCalendarAccess(access);
      }
      const count = await syncGoogleCalendar(services, access.accessToken);
      if (interactive) setNotice(`Google Calendar synced: ${count} busy block${count === 1 ? '' : 's'} hidden from the booking page.`);
    } catch (error) {
      console.error('Calendar Sync Error:', error);
      if (error.status === 401) setCalendarAccess(null);
      if (interactive) setErrorMessage(describeSyncError(error));
    } finally {
      setSyncing(false);
    }
  };

  // Keeps busy times fresh while the admin page stays open (only once access has been granted).
  useEffect(() => {
    if (!calendarAccess) return;
    const timer = setInterval(() => syncCalendar({ interactive: false }), RESYNC_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarAccess]);

  const signIn = async () => {
    setErrorMessage('');
    try {
      await services.signInWithPopup(services.auth, new services.GoogleAuthProvider());
    } catch (error) {
      console.error('Sign-in Error:', error);
      setErrorMessage(`Sign-in failed: ${error.code || error.message}`);
    }
  };

  // Moves a booking to a new status. Declining or cancelling also frees the slot for others.
  const decide = async (booking, status) => {
    setBusyId(booking.id);
    setNotice('');
    setErrorMessage('');

    try {
      const bookingRef = services.doc(services.db, 'bookings', booking.id);
      const cellRefs = getCellIds(booking).map(id => services.doc(services.db, 'slots', id));
      const update = { status, decidedAt: new Date().toISOString() };

      if (status === 'confirmed') {
        update.meetingLink = (meetingLinks[booking.id] ?? booking.meetingLink ?? '').trim();
      }

      // An expired hold may have been taken by someone else, and the booker may have just cancelled,
      // so check both right now.
      await services.runTransaction(services.db, async (transaction) => {
        const current = await transaction.get(bookingRef);
        const cells = await Promise.all(cellRefs.map(ref => transaction.get(ref)));
        const owned = cells.map(cell => cell.exists() && cell.data().bookingId === booking.id);

        if (current.data()?.status !== booking.status) throw new Error('ALREADY_CHANGED');

        if (status === 'confirmed') {
          if (!owned.every(Boolean)) throw new Error('SLOT_LOST');
          cellRefs.forEach(ref => transaction.update(ref, { confirmed: true }));
        } else {
          cellRefs.forEach((ref, index) => owned[index] && transaction.delete(ref));
        }

        transaction.update(bookingRef, update);
        // Keep the booker's private page in step (older bookings don't have one).
        if (booking.manageId) {
          transaction.update(services.doc(services.db, 'manage', booking.manageId), {
            status,
            ...(update.meetingLink !== undefined ? { meetingLink: update.meetingLink } : {})
          });
        }
      });

      const emailed = await sendEmail({
        toEmail: booking.email,
        ...emailTemplates[status]({ ...booking, ...update }),
        replyTo: ADMIN_EMAIL
      });

      setNotice(
        `${booking.name}'s booking is now ${status}. ` +
        (emailed ? `Email sent to ${booking.email}.` : `Email could NOT be sent; let ${booking.email} know yourself.`)
      );
    } catch (error) {
      console.error('Update Error:', error);
      setErrorMessage(
        error.message === 'SLOT_LOST'
          ? `Someone else has booked ${booking.name}'s time since their request expired. Decline it to let them know.`
          : error.message === 'ALREADY_CHANGED'
            ? `${booking.name}'s booking changed in the meantime (they may have cancelled). The list is now up to date.`
            : 'Unable to update the booking. Please try again.'
      );
    } finally {
      setBusyId(null);
    }
  };

  // Tab title shows how many requests are waiting, e.g. "(2) Admin · Bookly".
  const pendingCount = bookings.filter(b => b.status === 'pending').length;
  useEffect(() => {
    document.title = `${pendingCount ? `(${pendingCount}) ` : ''}Admin · Bookly`;
  }, [pendingCount]);

  // Success messages clear themselves; errors stay until dismissed.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!hasFirebaseConfig) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-ink mb-2">Firebase isn't set up</h1>
        <p className="text-sm text-ink-2">Fill in the <code>VITE_FIREBASE_*</code> values in <code>.env</code> and restart the dev server.</p>
      </AuthShell>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-8 text-brand animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="text-sm text-ink-2 mt-1 mb-8">Sign in as the host to review booking requests.</p>
        {errorMessage && <Banner className="mb-4">{errorMessage}</Banner>}
        <button onClick={signIn} className="btn btn-outline w-full py-3">
          <GoogleIcon /> Continue with Google
        </button>
      </AuthShell>
    );
  }

  if (!isAdmin) {
    return (
      <AuthShell>
        <div className="size-12 rounded-2xl bg-danger-soft grid place-items-center mb-4">
          <ShieldAlert className="text-danger" size={22} />
        </div>
        <h1 className="text-xl font-semibold text-ink">Not authorized</h1>
        <p className="text-sm text-ink-2 mt-1 mb-6">
          {user.email || 'This account'} isn't the host account{ADMIN_EMAIL ? '' : ' (VITE_ADMIN_EMAIL is not set in .env)'}.
        </p>
        <button onClick={() => services.signOut(services.auth)} className="btn btn-outline w-full">
          <LogOut size={16} /> Sign in with another account
        </button>
      </AuthShell>
    );
  }

  const now = Date.now();
  const todayKey = getHostTodayKey(now);
  const pending = bookings.filter(b => b.status === 'pending');
  const upcoming = bookings.filter(b => b.status === 'confirmed' && b.date >= todayKey);
  const history = bookings.filter(b => !pending.includes(b) && !upcoming.includes(b)).reverse();
  const lists = { pending, upcoming, history };
  const activeTab = TABS.find(t => t.id === tab);

  const getHoldInfo = (booking) => {
    const cells = getCellIds(booking).map(id => slotsById[id]);
    const slot = cells[0];
    const requestedAgo = `Requested ${formatDuration(now - Date.parse(booking.createdAt))} ago`;

    if (getSlotStartMs(booking.date, booking.time) < now) {
      return { lost: false, tone: 'text-ink-3', text: `${requestedAgo} · The meeting time has passed` };
    }
    if (cells.some(cell => !cell || cell.bookingId !== booking.id)) {
      return { lost: true, tone: 'text-danger', text: `${requestedAgo} · Hold expired and someone else booked this time` };
    }

    const expiresAt = getSlotExpiryMs(slot);
    if (expiresAt === null || expiresAt > now) {
      return { lost: false, tone: 'text-warn', text: `${requestedAgo}${expiresAt === null ? '' : ` · Held for another ${formatDuration(expiresAt - now)}`}` };
    }
    return { lost: false, tone: 'text-danger', text: `${requestedAgo} · Hold expired, so others can book this time. Confirm now to keep it` };
  };

  const stats = [
    { label: 'Needs decision', value: pending.length, Icon: Inbox, tone: 'bg-warn-soft text-warn' },
    { label: 'Upcoming meetings', value: upcoming.length, Icon: CalendarCheck, tone: 'bg-success-soft text-success' },
    { label: 'All-time requests', value: bookings.length, Icon: History, tone: 'bg-brand-soft text-brand-ink' }
  ];

  const renderBooking = (booking, { highlight = false } = {}) => {
    const hold = booking.status === 'pending' ? getHoldInfo(booking) : null;
    const isBusy = busyId === booking.id;

    return (
      <li key={booking.id} className={`card !rounded-2xl p-4 sm:p-5 animate-rise ${highlight ? 'ring-2 ring-brand' : ''}`}>
        <div className="flex gap-4">
          <DateTile dateKey={booking.date} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={booking.name} size="size-9" className="text-sm" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{booking.name}</p>
                  <a href={`mailto:${booking.email}`} className="text-sm text-ink-2 hover:text-brand inline-flex items-center gap-1 max-w-full">
                    <Mail size={13} className="shrink-0" /><span className="truncate">{booking.email}</span>
                  </a>
                </div>
              </div>
              <span className={`pill capitalize ${STATUS_STYLES[booking.status] || 'bg-muted text-ink-2'}`}>
                {booking.status === 'cancelled' && booking.cancelledBy === 'booker' ? 'Cancelled by guest' : booking.status}
              </span>
            </div>

            <p className="mt-3 text-sm text-ink flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <Clock size={14} className="text-ink-3" />
              <span className="font-medium">{getTimeLabel(booking.time)}</span>
              <span className="text-ink-3">· {formatMeetingLength(durationOf(booking))} · {TIME_ZONE_LABEL}</span>
            </p>
            <p className="mt-1 text-xs font-medium text-ink-2">{titleOf(booking)}</p>
            {booking.previousDate && (
              <p className="mt-1 text-xs text-ink-3">
                Moved by the guest from {getTimeLabel(booking.previousTime)}, {parseDateKey(booking.previousDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            )}

            {booking.answers?.length > 0 && (
              <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
                {booking.answers.map(answer => (
                  <React.Fragment key={answer.label}>
                    <dt className="text-ink-3">{answer.label}</dt>
                    <dd className="text-ink break-words whitespace-pre-wrap">{answer.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}

            {booking.notes && (
              <p className="mt-3 text-sm text-ink-2 bg-muted rounded-xl px-3.5 py-2.5 whitespace-pre-wrap border-l-2 border-brand">
                {booking.notes}
              </p>
            )}

            {booking.meetingLink && (
              <a href={booking.meetingLink} target="_blank" rel="noreferrer" className="mt-3 text-sm text-brand hover:underline inline-flex items-center gap-1.5 break-all">
                <Link2 size={14} className="shrink-0" /> {booking.meetingLink}
              </a>
            )}

            {hold && <p className={`mt-3 text-xs font-medium ${hold.tone}`}>{hold.text}</p>}
            {booking.status === 'pending' && overlapsBlock(booking.date, booking.time, blocks, 0, durationOf(booking)) && (
              <p className="mt-2 text-xs font-semibold text-danger">Clashes with a busy time in your calendar.</p>
            )}
          </div>
        </div>

        {booking.status === 'pending' && (
          <div className="mt-4 pt-4 border-t border-line flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Link2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input
                type="url"
                placeholder="Meeting link (optional)"
                aria-label={`Meeting link for ${booking.name}`}
                value={meetingLinks[booking.id] ?? booking.meetingLink ?? ''}
                onChange={(e) => setMeetingLinks({ ...meetingLinks, [booking.id]: e.target.value })}
                className="field !pl-10 !py-2.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => decide(booking, 'confirmed')}
                disabled={isBusy || hold?.lost}
                className="btn btn-success flex-1 sm:flex-none"
              >
                {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm
              </button>
              <button onClick={() => decide(booking, 'declined')} disabled={isBusy} className="btn btn-outline flex-1 sm:flex-none">
                <X size={16} /> Decline
              </button>
            </div>
          </div>
        )}

        {booking.status === 'confirmed' && booking.date >= todayKey && (
          <div className="mt-4 pt-3 border-t border-line flex justify-end">
            <button
              onClick={() => window.confirm(`Cancel ${booking.name}'s meeting and email them?`) && decide(booking, 'cancelled')}
              disabled={isBusy}
              className="btn btn-ghost !text-danger hover:!bg-danger-soft"
            >
              {isBusy ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Cancel meeting
            </button>
          </div>
        )}
      </li>
    );
  };

  // One booking opened from the host's email. Actions still need a click here, so link
  // scanners or an accidental tap on the email link can't confirm or decline anything.
  const renderReview = () => {
    const reviewed = bookings.find(b => b.id === review.bookingId);
    let hint = null;
    if (reviewed?.status === 'pending') {
      hint = review.action === 'decline'
        ? { tone: 'warn', text: `Tap Decline to let ${reviewed.name} know this time doesn't work.` }
        : { tone: 'success', text: `Check the details${review.action === 'confirm' ? ', then tap Confirm' : ''}. Add a meeting link first if you have one.` };
    } else if (reviewed) {
      hint = { tone: 'warn', text: `This booking is already ${reviewed.status === 'cancelled' && reviewed.cancelledBy === 'booker' ? 'cancelled by the guest' : reviewed.status}.` };
    }

    return (
      <section className="mb-10 animate-rise">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-xs font-bold text-ink-3 uppercase tracking-widest">From your email</h2>
          <a href="#admin" className="btn btn-ghost text-sm">Show all bookings</a>
        </div>
        {reviewed ? (
          <>
            {hint && <Banner tone={hint.tone} className="mb-3">{hint.text}</Banner>}
            <ul>{renderBooking(reviewed, { highlight: true })}</ul>
          </>
        ) : bookingsLoaded ? (
          <Banner>That booking wasn't found. It may have been deleted.</Banner>
        ) : (
          <div className="card !rounded-2xl p-5 space-y-3"><div className="skeleton h-5 w-1/3" /><div className="skeleton h-16 w-full" /></div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo suffix="Admin" />
          <div className="flex items-center gap-2">
            <Avatar name={user.displayName || user.email} src={user.photoURL} size="size-8" className="text-xs" />
            <button onClick={() => services.signOut(services.auth)} className="btn btn-ghost" aria-label="Sign out">
              <LogOut size={16} /><span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-8 animate-rise">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Hi{user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
          </h1>
          <p className="text-ink-2 mt-1">
            {pending.length
              ? `You have ${pending.length} request${pending.length === 1 ? '' : 's'} waiting for a decision.`
              : 'No requests are waiting on you.'}
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {!hasEmailConfig && (
            <Banner tone="warn">EmailJS isn't configured, so no emails will be sent. Fill in the <code>VITE_EMAILJS_*</code> values in <code>.env</code>.</Banner>
          )}
          {notice && <Banner tone="success" onDismiss={() => setNotice('')}>{notice}</Banner>}
          {errorMessage && <Banner onDismiss={() => setErrorMessage('')}>{errorMessage}</Banner>}
        </div>

        {review && renderReview()}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {stats.map(({ label, value, Icon, tone }) => (
            <div key={label} className="card !rounded-2xl p-5 flex items-center gap-4 animate-rise">
              <span className={`size-11 rounded-xl grid place-items-center ${tone}`}><Icon size={20} /></span>
              <div>
                <p className="text-2xl font-semibold text-ink tabular-nums">{value}</p>
                <p className="text-xs text-ink-2">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div role="tablist" aria-label="Bookings" className="flex max-w-full overflow-x-auto sm:inline-flex p-1 rounded-full bg-muted border border-line mb-6 [scrollbar-width:none]">
          {[...TABS, { id: 'settings', label: 'Settings' }].map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all inline-flex items-center justify-center gap-2
                ${tab === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
            >
              {id === 'settings' && <SettingsIcon size={15} />}
              {label}
              {lists[id] && (
                <span className={`text-xs tabular-nums rounded-full px-1.5 ${tab === id ? 'bg-brand-soft text-brand-ink' : 'text-ink-3'}`}>
                  {lists[id].length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'settings' ? (
          <Settings
            services={services}
            blocks={blocks}
            syncing={syncing}
            onSync={() => syncCalendar()}
            onSaved={setNotice}
            onError={setErrorMessage}
          />
        ) : lists[tab].length ? (
          <ul key={tab} className="space-y-3">{lists[tab].map(renderBooking)}</ul>
        ) : (
          <div key={tab} className="rounded-3xl border border-dashed border-line py-16 px-6 text-center animate-rise">
            <span className="mx-auto mb-4 size-12 rounded-2xl bg-muted grid place-items-center text-ink-3">
              <activeTab.Icon size={22} />
            </span>
            <p className="text-sm text-ink-2">{activeTab.empty}</p>
          </div>
        )}
      </main>
    </div>
  );
}
