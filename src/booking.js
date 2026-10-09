export const MEETING_TITLE = '30 Minute Meeting';
export const HOST_NAME = 'Prashant Sharma';
export const TIME_ZONE_LABEL = 'India Standard Time';
export const MEETING_DURATION_MINUTES = 30; // default length, and the size of one reservation cell

/* ---------- Meeting types (eventTypes collection, edited on the admin Settings tab) ---------- */

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
export const TYPE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Used until the host saves their own types; firestore.rules accepts this one without a saved doc.
export const DEFAULT_EVENT_TYPE = {
  id: '30min',
  title: MEETING_TITLE,
  duration: 30,
  description: '',
  meetingLink: '',
  autoConfirm: false,
  active: true,
  order: 0,
  questions: []
};

export const sortEventTypes = (types) => [...types].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));

export const formatDuration = (minutes) => (
  minutes < 60 ? `${minutes} min` : `${minutes / 60 === Math.floor(minutes / 60) ? minutes / 60 : (minutes / 60).toFixed(1)} hr`
);

export const slugify = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const getBookingUrl = (typeId) => `${window.location.origin}${window.location.pathname}#book/${typeId}`;

// Custom booking-form questions, per meeting type. firestore.rules caps these at 5 too.
export const MAX_QUESTIONS = 5;
export const QUESTION_KINDS = [
  { id: 'short', label: 'Short answer' },
  { id: 'long', label: 'Paragraph' },
  { id: 'phone', label: 'Phone number' },
  { id: 'choice', label: 'Multiple choice' }
];
const ANSWER_LIMITS = { short: 300, long: 1000, phone: 40, choice: 100 };

// Snapshot of the answered questions, stored on the booking as [{ label, value }] so later
// edits to the questions don't change what the guest actually answered.
export const collectAnswers = (questions, answers) => questions
  .map(question => ({
    label: question.label,
    value: (answers[question.id] || '').trim().slice(0, ANSWER_LIMITS[question.kind] || 300)
  }))
  .filter(answer => answer.value);

// Bookings made before meeting types existed have no type fields.
export const titleOf = (booking) => booking.typeTitle || MEETING_TITLE;
export const durationOf = (booking) => booking.duration || MEETING_DURATION_MINUTES;

// Booking policy. firestore.rules enforces the same numbers, so keep them in sync.
// IST has no daylight saving, so a fixed offset is exact.
const HOST_UTC_OFFSET_MINUTES = 330;
export const MIN_NOTICE_MINUTES = 120;
export const MAX_DAYS_AHEAD = 60;
export const PENDING_EXPIRY_HOURS = 48;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

// Parses a YYYY-MM-DD key as a local date (new Date('YYYY-MM-DD') would be UTC).
export const parseDateKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatDisplayDate = (date, includeYear = false) => (
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {})
  })
);

// Slot doc ids are `YYYY-MM-DD_HHMM`; firestore.rules checks this same format.
export const getSlotId = (dateKey, time) => `${dateKey}_${time.replace(':', '')}`;

const toMinutes = (time) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const fromMinutes = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// "09:30" -> "9:30am"
export const getTimeLabel = (time) => {
  const minutes = toMinutes(time);
  const hour = Math.floor(minutes / 60) % 24;
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minutes % 60).padStart(2, '0')}${hour >= 12 ? 'pm' : 'am'}`;
};

// Every half hour of the day, used by the admin hour pickers. "24:00" is allowed as an end time.
export const HALF_HOURS = Array.from({ length: 49 }, (_, index) => fromMinutes(index * 30));

/* ---------- Availability (stored in config/availability, edited on the admin Settings tab) ---------- */

// weekly is keyed by JS weekday (0 = Sunday). null means closed that day.
export const DEFAULT_AVAILABILITY = {
  weekly: {
    0: null,
    1: { start: '09:00', end: '17:00' },
    2: { start: '09:00', end: '17:00' },
    3: { start: '09:00', end: '17:00' },
    4: { start: '09:00', end: '17:00' },
    5: { start: '09:00', end: '17:00' },
    6: null
  },
  daysOff: [],
  bufferMinutes: 0,
  maxPerDay: 0 // 0 = no limit
};

export const normalizeAvailability = (data) => ({
  ...DEFAULT_AVAILABILITY,
  ...(data || {}),
  weekly: { ...DEFAULT_AVAILABILITY.weekly, ...(data?.weekly || {}) },
  daysOff: data?.daysOff || []
});

// All start times on a day according to the weekly hours (ignores bookings and notice).
// Starts are on the half hour; the whole meeting must end within the hours.
export const getDaySlots = (dateKey, availability, duration = MEETING_DURATION_MINUTES) => {
  if (availability.daysOff.includes(dateKey)) return [];
  const hours = availability.weekly[parseDateKey(dateKey).getDay()];
  if (!hours) return [];

  const times = [];
  for (let minutes = toMinutes(hours.start); minutes + duration <= toMinutes(hours.end); minutes += 30) {
    times.push(fromMinutes(minutes));
  }
  return times;
};

// A booking reserves every half-hour cell it touches (a 60-minute meeting at 10:00 holds 10:00 and 10:30),
// one `slots` doc per cell. That's what stops a longer meeting overlapping another booking.
export const getCellTimes = (time, duration = MEETING_DURATION_MINUTES) => {
  const start = toMinutes(time);
  return Array.from({ length: Math.ceil(duration / 30) }, (_, index) => fromMinutes(start + index * 30));
};

export const getCellIds = (booking) => getCellTimes(booking.time, durationOf(booking)).map(time => getSlotId(booking.date, time));

// Slot times are the host's wall-clock times, whatever time zone the visitor is in.
export const getSlotStartMs = (dateKey, time) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) - HOST_UTC_OFFSET_MINUTES * MINUTE_MS;
};

// Today's date in the host's time zone, as a YYYY-MM-DD key.
export const getHostTodayKey = (now = Date.now()) => {
  const hostNow = new Date(now + HOST_UTC_OFFSET_MINUTES * MINUTE_MS);
  return `${hostNow.getUTCFullYear()}-${String(hostNow.getUTCMonth() + 1).padStart(2, '0')}-${String(hostNow.getUTCDate()).padStart(2, '0')}`;
};

export const isSlotBookable = (dateKey, time, now = Date.now()) => {
  const start = getSlotStartMs(dateKey, time);
  return start >= now + MIN_NOTICE_MINUTES * MINUTE_MS && start <= now + MAX_DAYS_AHEAD * DAY_MS;
};

export const visitorIsInHostTimeZone = () => new Date().getTimezoneOffset() === -HOST_UTC_OFFSET_MINUTES;

export const formatInVisitorTime = (dateKey, time) => (
  new Date(getSlotStartMs(dateKey, time)).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
);

// A pending slot is held for PENDING_EXPIRY_HOURS, then anyone may claim it. Confirmed slots never expire.
// Only server timestamps expire; older docs with string timestamps are held until the host decides.
export const getSlotExpiryMs = (slot) => {
  if (slot.confirmed || typeof slot.createdAt?.toMillis !== 'function') return null;
  return slot.createdAt.toMillis() + PENDING_EXPIRY_HOURS * HOUR_MS;
};

export const isSlotHeld = (slot, now = Date.now()) => {
  const expiresAt = getSlotExpiryMs(slot);
  return expiresAt === null || expiresAt > now;
};

// Busy blocks ({ date, start, end }, host time, end exclusive) come from manual "block time"
// entries and Google Calendar sync. A meeting at `time` clashes if it overlaps one, buffer included.
export const overlapsBlock = (dateKey, time, blocks, bufferMinutes = 0, duration = MEETING_DURATION_MINUTES) => {
  const start = toMinutes(time);
  const end = start + duration;
  return blocks.some(block => (
    block.date === dateKey
    && start < toMinutes(block.end) + bufferMinutes
    && end + bufferMinutes > toMinutes(block.start)
  ));
};

// Open start times on a day for a meeting of `duration` minutes: inside working hours, outside the
// notice window, not overlapping a held cell or busy block (buffer included), and the day isn't at
// its meeting limit.
export const getAvailableTimes = (dateKey, availability, heldSlots, blocks = [], duration = MEETING_DURATION_MINUTES, now = Date.now()) => {
  const heldCells = heldSlots.filter(slot => slot.date === dateKey && isSlotHeld(slot, now));
  const meetingsThatDay = new Set(heldCells.map(slot => slot.bookingId ?? slot.id)).size;
  if (availability.maxPerDay > 0 && meetingsThatDay >= availability.maxPerDay) return [];

  const buffer = availability.bufferMinutes || 0;
  const busy = [...heldCells.map(slot => ({ date: dateKey, start: slot.time, end: fromMinutes(toMinutes(slot.time) + 30) })), ...blocks];
  return getDaySlots(dateKey, availability, duration).filter(time => (
    isSlotBookable(dateKey, time, now) && !overlapsBlock(dateKey, time, busy, buffer, duration)
  ));
};

// Turns Google free/busy intervals (ISO strings) into per-day blocks in host time,
// widened to the 30-minute grid and merged where they overlap.
export const busyIntervalsToBlocks = (intervals) => {
  const step = 30 * MINUTE_MS; // IST's +5:30 offset is a multiple of 30 minutes, so UTC and host grids line up
  const rangesByDate = {};

  for (const interval of intervals) {
    let start = Math.floor(Date.parse(interval.start) / step) * step;
    const end = Math.ceil(Date.parse(interval.end) / step) * step;
    while (start < end) {
      const dateKey = getHostTodayKey(start);
      const dayStart = getSlotStartMs(dateKey, '00:00');
      const segmentEnd = Math.min(end, dayStart + DAY_MS);
      (rangesByDate[dateKey] ||= []).push([(start - dayStart) / MINUTE_MS, (segmentEnd - dayStart) / MINUTE_MS]);
      start = segmentEnd;
    }
  }

  return Object.entries(rangesByDate).flatMap(([date, ranges]) => {
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    return merged.map(([start, end]) => ({ date, start: fromMinutes(start), end: fromMinutes(end) }));
  });
};

export const describeSlot = (dateKey, time) => (
  `${getTimeLabel(time)} - ${formatDisplayDate(parseDateKey(dateKey), true)} (${TIME_ZONE_LABEL})`
);

/* ---------- Booker's private manage link ---------- */

// 128-bit random code; knowing it is what lets a booker view and cancel their booking.
export const createManageToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

export const getManageUrl = (token) => `${window.location.origin}${window.location.pathname}#manage/${token}`;

/* ---------- Add to calendar ---------- */

const toIcsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const getEventDetails = (booking) => {
  const start = getSlotStartMs(booking.date, booking.time);
  return {
    start,
    end: start + durationOf(booking) * MINUTE_MS,
    title: `${titleOf(booking)} with ${HOST_NAME}`,
    details: booking.meetingLink ? `Join: ${booking.meetingLink}` : 'Meeting link to follow.',
    location: booking.meetingLink || 'Online'
  };
};

export const getGoogleCalendarUrl = (booking) => {
  const event = getEventDetails(booking);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toIcsTime(event.start)}/${toIcsTime(event.end)}`,
    details: event.details,
    location: event.location
  });
  return `https://calendar.google.com/calendar/render?${params}`;
};

export const getOutlookCalendarUrl = (booking) => {
  const event = getEventDetails(booking);
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: new Date(event.start).toISOString(),
    enddt: new Date(event.end).toISOString(),
    body: event.details,
    location: event.location
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
};

const escapeIcs = (text) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// .ics file for Apple Calendar and anything else that imports calendar files.
export const buildIcsFile = (booking, uid) => {
  const event = getEventDetails(booking);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bookly//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@bookly`,
    `DTSTAMP:${toIcsTime(Date.now())}`,
    `DTSTART:${toIcsTime(event.start)}`,
    `DTEND:${toIcsTime(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.details)}`,
    `LOCATION:${escapeIcs(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
};

// Browser-only: saves the .ics file via a temporary download link.
export const downloadIcsFile = (booking, uid) => {
  const url = URL.createObjectURL(new Blob([buildIcsFile(booking, uid)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'meeting.ics';
  link.click();
  URL.revokeObjectURL(url);
};

/* ---------- Emails (shared by the booking, manage and admin pages) ---------- */

const manageLine = (booking) => (
  booking.manageId ? `View or cancel your booking: ${getManageUrl(booking.manageId)}\n\n` : ''
);

// Admin deep links: open one booking on the admin page with Confirm/Decline ready (one click, never automatic).
export const getReviewUrl = (bookingId, action) => (
  `${window.location.origin}${window.location.pathname}#admin/review/${bookingId}${action ? `/${action}` : ''}`
);

const meetingLine = (booking) => `${titleOf(booking)} (${formatDuration(durationOf(booking))})`;
const dateOf = (booking) => formatDisplayDate(parseDateKey(booking.date), true);

// The guest's answers to the custom questions, then their free-text notes.
const detailsBlock = (booking) => (
  (booking.answers || []).map(answer => `${answer.label}: ${answer.value}\n`).join('') +
  `Notes: ${booking.notes || '(none)'}\n\n`
);

export const emailTemplates = {
  requestReceived: (booking) => ({
    subject: `Booking request received: ${titleOf(booking)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `We received your request for a ${meetingLine(booking)} with ${HOST_NAME} on ${describeSlot(booking.date, booking.time)}.\n\n` +
      `This booking is NOT confirmed yet. You will get another email as soon as it is confirmed or declined. ` +
      `If it isn't confirmed within ${PENDING_EXPIRY_HOURS} hours, the request expires and the time is released.\n\n` +
      manageLine(booking)
  }),
  hostNewRequest: (booking, bookingId) => ({
    subject: `New booking request from ${booking.name}`,
    message:
      `${booking.name} <${booking.email}> requested a ${meetingLine(booking)} on ${describeSlot(booking.date, booking.time)}.\n\n` +
      detailsBlock(booking) +
      `Confirm: ${getReviewUrl(bookingId, 'confirm')}\n` +
      `Decline: ${getReviewUrl(bookingId, 'decline')}\n\n` +
      `Respond within ${PENDING_EXPIRY_HOURS} hours, after which the time is released to others.`
  }),
  hostNewBooking: (booking, bookingId) => ({
    subject: `New booking: ${booking.name}, ${dateOf(booking)}`,
    message:
      `${booking.name} <${booking.email}> booked a ${meetingLine(booking)} on ${describeSlot(booking.date, booking.time)}.\n` +
      `It was confirmed automatically because this meeting type doesn't need approval.\n\n` +
      detailsBlock(booking) +
      `View or cancel it: ${getReviewUrl(bookingId)}`
  }),
  confirmed: (booking) => ({
    subject: `Confirmed: ${titleOf(booking)} on ${dateOf(booking)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Your ${meetingLine(booking)} with ${HOST_NAME} is confirmed for ${describeSlot(booking.date, booking.time)}.\n\n` +
      (booking.meetingLink ? `Join here: ${booking.meetingLink}\n\n` : 'Web conferencing details will follow.\n\n') +
      `Add it to your calendar:\n` +
      `Google: ${getGoogleCalendarUrl(booking)}\n` +
      `Outlook: ${getOutlookCalendarUrl(booking)}\n` +
      (booking.manageId ? `Apple / other (.ics): ${getManageUrl(booking.manageId)}\n` : '') +
      '\n' +
      manageLine(booking) +
      'See you then!'
  }),
  declined: (booking) => ({
    subject: `Not available: ${titleOf(booking)} on ${dateOf(booking)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Unfortunately ${HOST_NAME} can't make ${describeSlot(booking.date, booking.time)}. ` +
      'Please pick another time on the booking page.'
  }),
  cancelled: (booking) => ({
    subject: `Cancelled: ${titleOf(booking)} on ${dateOf(booking)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Your ${titleOf(booking)} on ${describeSlot(booking.date, booking.time)} has been cancelled by ${HOST_NAME}. ` +
      'Please pick another time on the booking page if you would still like to meet.'
  }),
  hostBookerCancelled: (booking) => ({
    subject: `${booking.name} cancelled their booking`,
    message:
      `${booking.name} cancelled their ${titleOf(booking)} on ${describeSlot(booking.date, booking.time)}.\n\n` +
      'The time is open again for others to book.'
  }),
  // `booking` already has the new date/time and status; `previous` is { date, time }.
  guestRescheduled: (booking, previous) => (booking.status === 'confirmed'
    ? {
      subject: `Moved: ${titleOf(booking)} is now ${dateOf(booking)}`,
      message:
        `Hi ${booking.name},\n\n` +
        `Your ${meetingLine(booking)} with ${HOST_NAME} has moved from ${describeSlot(previous.date, previous.time)} ` +
        `to ${describeSlot(booking.date, booking.time)}. It's confirmed.\n\n` +
        (booking.meetingLink ? `Join here: ${booking.meetingLink}\n\n` : '') +
        `Update your calendar:\n` +
        `Google: ${getGoogleCalendarUrl(booking)}\n` +
        `Outlook: ${getOutlookCalendarUrl(booking)}\n\n` +
        manageLine(booking)
    }
    : {
      subject: `Change requested: ${titleOf(booking)} on ${dateOf(booking)}`,
      message:
        `Hi ${booking.name},\n\n` +
        `You asked to move your ${meetingLine(booking)} from ${describeSlot(previous.date, previous.time)} ` +
        `to ${describeSlot(booking.date, booking.time)}.\n\n` +
        `${HOST_NAME} needs to confirm the new time. You'll get another email either way.\n\n` +
        manageLine(booking)
    }),
  hostRescheduled: (booking, bookingId, previous) => ({
    subject: `${booking.name} moved their booking to ${dateOf(booking)}`,
    message:
      `${booking.name} <${booking.email}> moved their ${meetingLine(booking)} ` +
      `from ${describeSlot(previous.date, previous.time)} to ${describeSlot(booking.date, booking.time)}.\n\n` +
      (booking.status === 'confirmed'
        ? `It stays confirmed because this meeting type doesn't need approval.\nView it: ${getReviewUrl(bookingId)}`
        : `The new time needs your approval.\nConfirm: ${getReviewUrl(bookingId, 'confirm')}\nDecline: ${getReviewUrl(bookingId, 'decline')}`)
  })
};
