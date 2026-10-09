export const MEETING_TITLE = '30 Minute Meeting';
export const HOST_NAME = 'Prashant Sharma';
export const TIME_ZONE_LABEL = 'India Standard Time';
export const MEETING_DURATION_MINUTES = 30;

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
export const getDaySlots = (dateKey, availability) => {
  if (availability.daysOff.includes(dateKey)) return [];
  const hours = availability.weekly[parseDateKey(dateKey).getDay()];
  if (!hours) return [];

  const times = [];
  for (let minutes = toMinutes(hours.start); minutes + MEETING_DURATION_MINUTES <= toMinutes(hours.end); minutes += 30) {
    times.push(fromMinutes(minutes));
  }
  return times;
};

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
export const overlapsBlock = (dateKey, time, blocks, bufferMinutes = 0) => {
  const start = toMinutes(time);
  const end = start + MEETING_DURATION_MINUTES;
  return blocks.some(block => (
    block.date === dateKey
    && start < toMinutes(block.end) + bufferMinutes
    && end + bufferMinutes > toMinutes(block.start)
  ));
};

// Open times on a day: inside working hours, outside the notice window, not held, not busy,
// not within the buffer of a held meeting or busy block, and the day isn't at its meeting limit.
export const getAvailableTimes = (dateKey, availability, heldSlots, blocks = [], now = Date.now()) => {
  const heldTimes = heldSlots
    .filter(slot => slot.date === dateKey && isSlotHeld(slot, now))
    .map(slot => toMinutes(slot.time));

  if (availability.maxPerDay > 0 && heldTimes.length >= availability.maxPerDay) return [];

  const buffer = availability.bufferMinutes || 0;
  const minGap = MEETING_DURATION_MINUTES + buffer;
  return getDaySlots(dateKey, availability).filter(time => {
    const minutes = toMinutes(time);
    return isSlotBookable(dateKey, time, now)
      && heldTimes.every(held => Math.abs(held - minutes) >= minGap)
      && !overlapsBlock(dateKey, time, blocks, buffer);
  });
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
    end: start + MEETING_DURATION_MINUTES * MINUTE_MS,
    title: `${MEETING_TITLE} with ${HOST_NAME}`,
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

/* ---------- Emails (shared by the booking, manage and admin pages) ---------- */

const manageLine = (booking) => (
  booking.manageId ? `View or cancel your booking: ${getManageUrl(booking.manageId)}\n\n` : ''
);

export const emailTemplates = {
  requestReceived: (booking) => ({
    subject: `Booking request received: ${MEETING_TITLE}`,
    message:
      `Hi ${booking.name},\n\n` +
      `We received your request for a ${MEETING_TITLE} with ${HOST_NAME} on ${describeSlot(booking.date, booking.time)}.\n\n` +
      `This booking is NOT confirmed yet. You will get another email as soon as it is confirmed or declined. ` +
      `If it isn't confirmed within ${PENDING_EXPIRY_HOURS} hours, the request expires and the time is released.\n\n` +
      manageLine(booking)
  }),
  hostNewRequest: (booking, adminUrl) => ({
    subject: `New booking request from ${booking.name}`,
    message:
      `${booking.name} <${booking.email}> requested ${describeSlot(booking.date, booking.time)}.\n\n` +
      `Notes: ${booking.notes || '(none)'}\n\n` +
      `Confirm or decline it within ${PENDING_EXPIRY_HOURS} hours, after which the time is released to others: ${adminUrl}`
  }),
  confirmed: (booking) => ({
    subject: `Confirmed: ${MEETING_TITLE} on ${formatDisplayDate(parseDateKey(booking.date), true)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Your ${MEETING_TITLE} with ${HOST_NAME} is confirmed for ${describeSlot(booking.date, booking.time)}.\n\n` +
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
    subject: `Not available: ${MEETING_TITLE} on ${formatDisplayDate(parseDateKey(booking.date), true)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Unfortunately ${HOST_NAME} can't make ${describeSlot(booking.date, booking.time)}. ` +
      'Please pick another time on the booking page.'
  }),
  cancelled: (booking) => ({
    subject: `Cancelled: ${MEETING_TITLE} on ${formatDisplayDate(parseDateKey(booking.date), true)}`,
    message:
      `Hi ${booking.name},\n\n` +
      `Your ${MEETING_TITLE} on ${describeSlot(booking.date, booking.time)} has been cancelled by ${HOST_NAME}. ` +
      'Please pick another time on the booking page if you would still like to meet.'
  }),
  hostBookerCancelled: (booking) => ({
    subject: `${booking.name} cancelled their booking`,
    message:
      `${booking.name} cancelled their ${MEETING_TITLE} on ${describeSlot(booking.date, booking.time)}.\n\n` +
      'The time is open again for others to book.'
  })
};
