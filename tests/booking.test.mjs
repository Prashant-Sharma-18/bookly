// Unit tests for the booking logic in src/booking.js. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIcsFile,
  busyIntervalsToBlocks,
  collectAnswers,
  createManageToken,
  getAvailableTimes,
  getCellIds,
  getCellTimes,
  getGoogleCalendarUrl,
  getHostTodayKey,
  getSlotStartMs,
  getTimeLabel,
  isSlotBookable,
  isSlotHeld,
  normalizeAvailability,
  overlapsBlock,
  slugify,
  TYPE_ID_PATTERN
} from '../src/booking.js';

// Friday 2026-10-09, 10:30 IST.
const NOW = Date.parse('2026-10-09T05:00:00Z');
const MONDAY = '2026-10-12';
const DEFAULTS = normalizeAvailability(undefined);
const hoursAgo = (hours) => ({ toMillis: () => NOW - hours * 3600e3 });
const cell = (time, extra = {}) => ({ date: MONDAY, time, bookingId: `b-${time}`, confirmed: true, ...extra });

test('slot times are IST wall-clock times', () => {
  assert.equal(new Date(getSlotStartMs('2026-10-09', '11:00')).toISOString(), '2026-10-09T05:30:00.000Z');
  assert.equal(getHostTodayKey(Date.parse('2026-10-09T20:00:00Z')), '2026-10-10'); // already the 10th in India
});

test('notice period and booking window', () => {
  assert.equal(isSlotBookable('2026-10-09', '12:00', NOW), false); // 90 minutes away
  assert.equal(isSlotBookable('2026-10-09', '12:30', NOW), true); // exactly 2 hours
  assert.equal(isSlotBookable('2026-10-09', '09:00', NOW), false); // past
  assert.equal(isSlotBookable('2026-12-09', '10:00', NOW), false); // 61 days ahead
});

test('pending holds expire after 48 hours; confirmed and legacy holds do not', () => {
  assert.equal(isSlotHeld({ createdAt: hoursAgo(47) }, NOW), true);
  assert.equal(isSlotHeld({ createdAt: hoursAgo(49) }, NOW), false);
  assert.equal(isSlotHeld({ confirmed: true, createdAt: hoursAgo(99) }, NOW), true);
  assert.equal(isSlotHeld({ createdAt: '2026-01-01T00:00:00Z' }, NOW), true);
  assert.equal(isSlotHeld({ createdAt: null }, NOW), true); // local write not yet confirmed by the server
});

test('default hours: Mon-Fri 9:00-17:00 in 30-minute starts', () => {
  const times = getAvailableTimes(MONDAY, DEFAULTS, [], [], 30, NOW);
  assert.equal(times.length, 16);
  assert.equal(times[0], '09:00');
  assert.equal(times.at(-1), '16:30');
  assert.deepEqual(getAvailableTimes('2026-10-10', DEFAULTS, [], [], 30, NOW), []); // Saturday
});

test('longer meetings must end within working hours', () => {
  assert.equal(getAvailableTimes(MONDAY, DEFAULTS, [], [], 60, NOW).at(-1), '16:00');
  assert.equal(getAvailableTimes(MONDAY, DEFAULTS, [], [], 120, NOW).at(-1), '15:00');
  assert.equal(getAvailableTimes(MONDAY, DEFAULTS, [], [], 15, NOW).at(-1), '16:30');
});

test('held cells block every start that would overlap them', () => {
  const held = [cell('10:00')];
  const thirty = getAvailableTimes(MONDAY, DEFAULTS, held, [], 30, NOW);
  assert.ok(!thirty.includes('10:00') && thirty.includes('09:30') && thirty.includes('10:30'));

  const sixty = getAvailableTimes(MONDAY, DEFAULTS, held, [], 60, NOW);
  assert.ok(!sixty.includes('09:30') && !sixty.includes('10:00'));
  assert.ok(sixty.includes('09:00') && sixty.includes('10:30'));
});

test('buffer keeps space around held meetings and busy blocks', () => {
  const buffered = { ...DEFAULTS, bufferMinutes: 15 };
  const times = getAvailableTimes(MONDAY, buffered, [cell('10:00')], [], 30, NOW);
  assert.ok(!times.includes('09:30') && !times.includes('10:30'));
  assert.ok(times.includes('09:00') && times.includes('11:00'));
});

test('daily limit counts bookings, not half-hour cells', () => {
  const limited = { ...DEFAULTS, maxPerDay: 2 };
  const oneLongMeeting = [cell('10:00', { bookingId: 'a' }), cell('10:30', { bookingId: 'a' })];
  assert.ok(getAvailableTimes(MONDAY, limited, oneLongMeeting, [], 30, NOW).length > 0);
  const twoMeetings = [...oneLongMeeting, cell('14:00', { bookingId: 'b' })];
  assert.deepEqual(getAvailableTimes(MONDAY, limited, twoMeetings, [], 30, NOW), []);
});

test('days off and custom hours', () => {
  assert.deepEqual(getAvailableTimes(MONDAY, { ...DEFAULTS, daysOff: [MONDAY] }, [], [], 30, NOW), []);
  const evenings = normalizeAvailability({ weekly: { 1: { start: '18:00', end: '24:00' } } });
  const times = getAvailableTimes(MONDAY, evenings, [], [], 30, NOW);
  assert.equal(times[0], '18:00');
  assert.equal(times.at(-1), '23:30');
});

test('busy blocks hide overlapping times', () => {
  const blocks = [{ date: MONDAY, start: '15:00', end: '16:00' }];
  assert.equal(overlapsBlock(MONDAY, '15:30', blocks), true);
  assert.equal(overlapsBlock(MONDAY, '14:30', blocks), false);
  assert.equal(overlapsBlock(MONDAY, '14:30', blocks, 0, 60), true); // a 60-minute meeting runs into it
  assert.equal(overlapsBlock(MONDAY, '16:00', blocks, 15), true); // buffer
  const times = getAvailableTimes(MONDAY, DEFAULTS, [], blocks, 30, NOW);
  assert.ok(!times.includes('15:00') && !times.includes('15:30') && times.includes('16:00'));
});

test('Google free/busy intervals become IST blocks on the 30-minute grid', () => {
  assert.deepEqual(
    busyIntervalsToBlocks([{ start: '2026-10-12T09:40:00Z', end: '2026-10-12T09:50:00Z' }]),
    [{ date: MONDAY, start: '15:00', end: '15:30' }]
  );
  assert.deepEqual(
    busyIntervalsToBlocks([
      { start: '2026-10-12T09:30:00Z', end: '2026-10-12T10:00:00Z' },
      { start: '2026-10-12T09:45:00Z', end: '2026-10-12T11:00:00Z' }
    ]),
    [{ date: MONDAY, start: '15:00', end: '16:30' }]
  );
  assert.deepEqual(
    busyIntervalsToBlocks([{ start: '2026-10-12T17:30:00Z', end: '2026-10-12T19:30:00Z' }]),
    [{ date: MONDAY, start: '23:00', end: '24:00' }, { date: '2026-10-13', start: '00:00', end: '01:00' }]
  );
});

test('meetings reserve one cell per half hour they touch', () => {
  assert.deepEqual(getCellTimes('10:00', 15), ['10:00']);
  assert.deepEqual(getCellTimes('10:00', 45), ['10:00', '10:30']);
  assert.deepEqual(getCellTimes('10:00', 120), ['10:00', '10:30', '11:00', '11:30']);
  assert.deepEqual(getCellIds({ date: MONDAY, time: '09:30', duration: 60 }), [`${MONDAY}_0930`, `${MONDAY}_1000`]);
  assert.deepEqual(getCellIds({ date: MONDAY, time: '09:30' }), [`${MONDAY}_0930`]); // legacy booking, 30 minutes
});

test('calendar links use the booking length', () => {
  const booking = { date: MONDAY, time: '10:00', duration: 60, typeTitle: 'Deep dive', meetingLink: 'https://meet.example/x' };
  const dates = new URL(getGoogleCalendarUrl(booking)).searchParams.get('dates');
  assert.equal(dates, '20261012T043000Z/20261012T053000Z');
  const ics = buildIcsFile(booking, 'abc');
  assert.ok(ics.includes('DTEND:20261012T053000Z'));
  assert.ok(ics.includes('SUMMARY:Deep dive with'));
  assert.ok(ics.includes('\r\n'));
});

test('answers are snapshotted with their labels, trimmed and capped', () => {
  const questions = [
    { id: 'a', label: 'Company', kind: 'short' },
    { id: 'b', label: 'Phone', kind: 'phone' },
    { id: 'c', label: 'Skipped', kind: 'long' }
  ];
  assert.deepEqual(
    collectAnswers(questions, { a: '  Acme  ', b: '9'.repeat(60), c: '   ' }),
    [{ label: 'Company', value: 'Acme' }, { label: 'Phone', value: '9'.repeat(40) }]
  );
});

test('labels, slugs and tokens', () => {
  assert.equal(getTimeLabel('00:30'), '12:30am');
  assert.equal(getTimeLabel('12:00'), '12:00pm');
  assert.equal(slugify('  Intro Call (15 min)! '), 'intro-call-15-min');
  assert.ok(TYPE_ID_PATTERN.test('intro-call') && !TYPE_ID_PATTERN.test('-bad') && !TYPE_ID_PATTERN.test('Bad'));
  assert.match(createManageToken(), /^[a-f0-9]{32}$/);
});
