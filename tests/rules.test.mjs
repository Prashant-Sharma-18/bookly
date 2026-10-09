// Security rules tests against the Firestore emulator. Run with `npm run test:rules`
// (needs Java; the Firebase CLI downloads the emulator on first run).
// The committed rules use the admin placeholder host@example.com, so that's the admin here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc
} from 'firebase/firestore';

const ADMIN = 'host@example.com';
const IST = 330 * 60e3;
const DAY = 86400e3;
const now = Date.now();

const istDate = (ms) => {
  const d = new Date(ms + IST);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const weekday = (dateKey) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();
const dayAhead = (fromDays, matches) => {
  let ms = now + fromDays * DAY;
  while (!matches(weekday(istDate(ms)))) ms += DAY;
  return istDate(ms);
};
const weekdayAhead = (fromDays) => dayAhead(fromDays, d => d >= 1 && d <= 5);
const weekendAhead = (fromDays) => dayAhead(fromDays, d => d === 0 || d === 6);
const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const addMinutes = (time, minutes) => {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const cellTimes = (time, duration) => Array.from({ length: Math.ceil(duration / 30) }, (_, i) => addMinutes(time, i * 30));

let env;
let visitor;
let admin;
let stranger;

// Writes a booking the way src/App.jsx does: booking + manage doc + one slot per half-hour cell.
const book = (db, date, time, {
  typeId = '30min', duration = 30, status = 'pending', meetingLink = '', cells, booking = {}, manage = {}, cell = {}
} = {}) => runTransaction(db, async (tx) => {
  const manageId = token();
  const bookingRef = doc(collection(db, 'bookings'));
  const times = cells ?? cellTimes(time, duration);
  const cellRefs = times.map(t => doc(db, 'slots', `${date}_${t.replace(':', '')}`));
  for (const ref of cellRefs) await tx.get(ref);
  const createdAt = new Date().toISOString();
  tx.set(bookingRef, {
    date, time, name: 'Test', email: 't@example.com', notes: '', status, manageId,
    typeId, typeTitle: 'Test meeting', duration, meetingLink, createdAt, ...booking
  });
  tx.set(doc(db, 'manage', manageId), {
    bookingId: bookingRef.id, date, time, name: 'Test', email: 't@example.com', status, typeId,
    typeTitle: 'Test meeting', duration, meetingLink, createdAt, ...manage
  });
  cellRefs.forEach((ref, i) => tx.set(ref, {
    date, time: times[i], bookingId: bookingRef.id, confirmed: status === 'confirmed', createdAt: serverTimestamp(), ...cell
  }));
  return { manageId, bookingId: bookingRef.id, cellIds: cellRefs.map(ref => ref.id) };
});

const guestCancel = (db, booking, { freeCells = true } = {}) => runTransaction(db, async (tx) => {
  const at = new Date().toISOString();
  tx.update(doc(db, 'manage', booking.manageId), { status: 'cancelled', cancelledAt: at });
  tx.update(doc(db, 'bookings', booking.bookingId), { status: 'cancelled', cancelledBy: 'booker', decidedAt: at });
  if (freeCells) booking.cellIds.forEach(id => tx.delete(doc(db, 'slots', id)));
});

const saveType = (db, id, fields = {}) => setDoc(doc(db, 'eventTypes', id), {
  title: 'Meeting', duration: 30, description: '', meetingLink: '', autoConfirm: false, active: true, order: 0, ...fields
});

const readAsAdmin = async (path) => {
  let data;
  await env.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDoc(doc(context.firestore(), path));
    data = snapshot.exists() ? snapshot.data() : null;
  });
  return data;
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bookly',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
  visitor = env.unauthenticatedContext().firestore();
  admin = env.authenticatedContext('host', { email: ADMIN, email_verified: true }).firestore();
  stranger = env.authenticatedContext('someone', { email: 'someone@example.com', email_verified: true }).firestore();
});

beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

describe('booking with the default meeting type (no saved types)', () => {
  test('a weekday request inside default hours is accepted', async () => {
    await assertSucceeds(book(visitor, weekdayAhead(3), '10:00'));
  });

  test('the same time cannot be booked twice', async () => {
    const date = weekdayAhead(3);
    await book(visitor, date, '10:00');
    await assertFails(book(visitor, date, '10:00'));
  });

  test('default hours are Mon-Fri 9:00-17:00', async () => {
    const date = weekdayAhead(3);
    await assertFails(book(visitor, date, '08:00'));
    await assertSucceeds(book(visitor, date, '16:30'));
    await assertFails(book(visitor, date, '17:00'));
    await assertFails(book(visitor, weekendAhead(3), '10:00'));
  });

  test('notice period and booking window', async () => {
    await assertFails(book(visitor, istDate(now), '00:00'));
    await assertFails(book(visitor, weekdayAhead(70), '10:00'));
  });

  test('the default type cannot be confirmed instantly or lengthened', async () => {
    const date = weekdayAhead(3);
    await assertFails(book(visitor, date, '10:00', { status: 'confirmed' }));
    await assertFails(book(visitor, date, '11:00', { duration: 60 }));
    await assertFails(book(visitor, date, '12:00', { typeId: 'made-up' }));
  });

  test('a client-chosen createdAt is rejected', async () => {
    await assertFails(book(visitor, weekdayAhead(3), '10:00', { cell: { createdAt: Timestamp.fromMillis(now) } }));
  });

  test('booking and manage doc must point at each other', async () => {
    const date = weekdayAhead(3);
    await assertFails(book(visitor, date, '10:00', { booking: { manageId: token() } }));
    await assertFails(book(visitor, date, '11:00', { manage: { status: 'confirmed' } }));
  });
});

describe('meeting types', () => {
  test('only the host can create types, with valid fields', async () => {
    await assertSucceeds(saveType(admin, 'intro', { duration: 60 }));
    await assertFails(saveType(visitor, 'other'));
    await assertFails(saveType(stranger, 'other'));
    await assertFails(saveType(admin, 'bad-length', { duration: 20 }));
    await assertFails(saveType(admin, 'Bad_Id'));
    await assertFails(saveType(admin, 'phish', { meetingLink: 'http://insecure.example' }));
    await assertSucceeds(getDocs(collection(visitor, 'eventTypes')));
  });

  test('a 60-minute type needs both of its half-hour cells', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const date = weekdayAhead(3);
    await assertSucceeds(book(visitor, date, '10:00', { typeId: 'deep', duration: 60 }));
    await assertFails(book(visitor, date, '14:00', { typeId: 'deep', duration: 60, cells: ['14:00'] }));
  });

  test('a 120-minute booking (four cells) fits within the rules access limits', async () => {
    await saveType(admin, 'workshop', { duration: 120 });
    await assertSucceeds(book(visitor, weekdayAhead(3), '10:00', { typeId: 'workshop', duration: 120 }));
  });

  test('longer meetings cannot overlap existing ones', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const date = weekdayAhead(3);
    await book(visitor, date, '10:00', { typeId: 'deep', duration: 60 });
    await assertFails(book(visitor, date, '10:30')); // 30 min into the 60-minute meeting
    await assertFails(book(visitor, date, '09:30', { typeId: 'deep', duration: 60 })); // runs into it
    await assertSucceeds(book(visitor, date, '11:00'));
  });

  test('length must match the type, and the meeting must end within hours', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const date = weekdayAhead(3);
    await assertFails(book(visitor, date, '10:00', { typeId: 'deep', duration: 30 }));
    await assertFails(book(visitor, date, '16:30', { typeId: 'deep', duration: 60 })); // would end 17:30
  });

  test('cells outside the booking are rejected', async () => {
    await assertFails(book(visitor, weekdayAhead(3), '10:00', { cells: ['10:00', '15:00'] }));
  });

  test('instant confirmation only for types that allow it, with their fixed link', async () => {
    await saveType(admin, 'quick', { duration: 15, autoConfirm: true, meetingLink: 'https://meet.example/room' });
    await saveType(admin, 'approval', { duration: 30 });
    const date = weekdayAhead(3);
    await assertSucceeds(book(visitor, date, '10:00', { typeId: 'quick', duration: 15, status: 'confirmed', meetingLink: 'https://meet.example/room' }));
    await assertFails(book(visitor, date, '11:00', { typeId: 'quick', duration: 15, status: 'confirmed', meetingLink: 'https://evil.example' }));
    await assertFails(book(visitor, date, '12:00', { typeId: 'quick', duration: 15, status: 'confirmed', meetingLink: 'https://meet.example/room', cell: { confirmed: false } }));
    await assertFails(book(visitor, date, '13:00', { typeId: 'approval', status: 'confirmed' }));
    await assertSucceeds(book(visitor, date, '14:00', { typeId: 'quick', duration: 15, status: 'pending', meetingLink: 'https://meet.example/room' }));
  });

  test('inactive types cannot be booked', async () => {
    await saveType(admin, 'paused', { active: false });
    await assertFails(book(visitor, weekdayAhead(3), '10:00', { typeId: 'paused' }));
  });
});

describe('guest manage page and cancellation', () => {
  test('the token holder can read their booking; nobody can list them', async () => {
    const booking = await book(visitor, weekdayAhead(3), '10:00');
    await assertSucceeds(getDoc(doc(visitor, 'manage', booking.manageId)));
    await assertFails(getDocs(collection(visitor, 'manage')));
    await assertFails(updateDoc(doc(visitor, 'manage', booking.manageId), { status: 'confirmed' }));
  });

  test('only the token holder can cancel, and all cells are freed', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const date = weekdayAhead(3);
    const booking = await book(visitor, date, '10:00', { typeId: 'deep', duration: 60 });

    await assertFails(guestCancel(stranger, { ...booking, manageId: token() }));
    await assertFails(deleteDoc(doc(stranger, 'slots', booking.cellIds[0])));
    await assertFails(updateDoc(doc(stranger, 'bookings', booking.bookingId), { status: 'cancelled', cancelledBy: 'booker', decidedAt: 'x' }));

    await assertSucceeds(guestCancel(visitor, booking));
    assert.equal((await readAsAdmin(`bookings/${booking.bookingId}`)).status, 'cancelled');
    assert.equal(await readAsAdmin(`slots/${booking.cellIds[1]}`), null);
    await assertFails(guestCancel(visitor, booking, { freeCells: false })); // already cancelled
    await assertSucceeds(book(visitor, date, '10:30')); // time is free again
  });
});

describe('host decisions', () => {
  test('confirming updates booking, manage doc and every cell', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const booking = await book(visitor, weekdayAhead(3), '10:00', { typeId: 'deep', duration: 60 });
    await assertSucceeds(runTransaction(admin, async (tx) => {
      booking.cellIds.forEach(id => tx.update(doc(admin, 'slots', id), { confirmed: true }));
      tx.update(doc(admin, 'bookings', booking.bookingId), { status: 'confirmed', meetingLink: 'https://meet.example/x', decidedAt: 'x' });
      tx.update(doc(admin, 'manage', booking.manageId), { status: 'confirmed', meetingLink: 'https://meet.example/x' });
    }));
    await assertFails(updateDoc(doc(stranger, 'slots', booking.cellIds[0]), { confirmed: false }));
    await assertFails(updateDoc(doc(admin, 'slots', booking.cellIds[0]), { bookingId: 'other' }));
    await assertSucceeds(guestCancel(visitor, booking)); // guests can still cancel confirmed meetings
  });

  test('only the host can read bookings', async () => {
    await book(visitor, weekdayAhead(3), '10:00');
    await assertSucceeds(getDocs(collection(admin, 'bookings')));
    await assertFails(getDocs(collection(visitor, 'bookings')));
    await assertFails(getDocs(collection(stranger, 'bookings')));
  });
});

describe('pending holds', () => {
  const seedCell = (date, time, data) => env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'slots', `${date}_${time.replace(':', '')}`), { date, time, bookingId: 'old', ...data }
  ));

  test('an expired pending hold can be taken over; fresh, confirmed and legacy ones cannot', async () => {
    const date = weekdayAhead(5);
    await seedCell(date, '10:00', { confirmed: false, createdAt: Timestamp.fromMillis(now - 49 * 3600e3) });
    await seedCell(date, '11:00', { confirmed: false, createdAt: Timestamp.fromMillis(now - 3600e3) });
    await seedCell(date, '12:00', { confirmed: true, createdAt: Timestamp.fromMillis(now - 99 * 3600e3) });
    await seedCell(date, '13:00', { createdAt: new Date(now - 99 * 3600e3).toISOString() });
    await assertSucceeds(book(visitor, date, '10:00'));
    await assertFails(book(visitor, date, '11:00'));
    await assertFails(book(visitor, date, '12:00'));
    await assertFails(book(visitor, date, '13:00'));
  });
});

// Moves a booking the way src/Manage.jsx does. `booking` comes from book(); `from` describes its
// current { date, time, duration }.
const reschedule = (db, booking, from, to, { status = 'pending', manageId = booking.manageId, updateManage = true, cellOverrides = {} } = {}) => (
  runTransaction(db, async (tx) => {
    const oldIds = cellTimes(from.time, from.duration).map(t => `${from.date}_${t.replace(':', '')}`);
    const newTimes = cellTimes(to.time, from.duration);
    const newIds = newTimes.map(t => `${to.date}_${t.replace(':', '')}`);
    for (const id of [...oldIds, ...newIds]) await tx.get(doc(db, 'slots', id));
    const at = serverTimestamp();
    tx.update(doc(db, 'bookings', booking.bookingId), {
      date: to.date, time: to.time, status, rescheduledAt: at, previousDate: from.date, previousTime: from.time
    });
    if (updateManage) tx.update(doc(db, 'manage', manageId), { date: to.date, time: to.time, status, rescheduledAt: at });
    newIds.forEach((id, i) => tx.set(doc(db, 'slots', id), {
      date: to.date, time: newTimes[i], bookingId: booking.bookingId, confirmed: status === 'confirmed', createdAt: at, ...cellOverrides
    }));
    oldIds.filter(id => !newIds.includes(id)).forEach(id => tx.delete(doc(db, 'slots', id)));
    return newIds;
  })
);

describe('guest rescheduling', () => {
  test('a pending booking moves to a free time; the old time is released', async () => {
    const date = weekdayAhead(3);
    const booking = await book(visitor, date, '10:00');
    await assertSucceeds(reschedule(visitor, booking, { date, time: '10:00', duration: 30 }, { date, time: '14:00' }));
    const moved = await readAsAdmin(`bookings/${booking.bookingId}`);
    assert.equal(moved.time, '14:00');
    assert.equal(moved.previousTime, '10:00');
    assert.equal(await readAsAdmin(`slots/${date}_1000`), null);
    assert.equal((await readAsAdmin(`manage/${booking.manageId}`)).time, '14:00');
    await assertSucceeds(book(visitor, date, '10:00')); // old time is bookable again
  });

  test('a longer meeting can move onto times overlapping itself', async () => {
    await saveType(admin, 'deep', { duration: 60 });
    const date = weekdayAhead(3);
    const booking = await book(visitor, date, '10:00', { typeId: 'deep', duration: 60 });
    await assertSucceeds(reschedule(visitor, booking, { date, time: '10:00', duration: 60 }, { date, time: '10:30' }));
    assert.equal(await readAsAdmin(`slots/${date}_1000`), null);
    assert.equal((await readAsAdmin(`slots/${date}_1100`)).bookingId, booking.bookingId);
  });

  test('approval types go back to pending; instant types stay confirmed', async () => {
    await saveType(admin, 'quick', { duration: 15, autoConfirm: true });
    const date = weekdayAhead(3);
    const approval = await book(visitor, date, '10:00');
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, 'bookings', approval.bookingId), { status: 'confirmed' });
      await updateDoc(doc(db, 'manage', approval.manageId), { status: 'confirmed' });
      await updateDoc(doc(db, 'slots', approval.cellIds[0]), { confirmed: true });
    });
    await assertFails(reschedule(visitor, approval, { date, time: '10:00', duration: 30 }, { date, time: '11:00' }, { status: 'confirmed' }));
    await assertSucceeds(reschedule(visitor, approval, { date, time: '10:00', duration: 30 }, { date, time: '11:00' }, { status: 'pending' }));

    const instant = await book(visitor, date, '13:00', { typeId: 'quick', duration: 15, status: 'confirmed' });
    await assertSucceeds(reschedule(visitor, instant, { date, time: '13:00', duration: 15 }, { date, time: '15:00' }, { status: 'confirmed' }));
  });

  test('cannot move into a taken time, outside hours, or without the manage doc', async () => {
    const date = weekdayAhead(3);
    const booking = await book(visitor, date, '10:00');
    await book(visitor, date, '12:00');
    const from = { date, time: '10:00', duration: 30 };
    await assertFails(reschedule(visitor, booking, from, { date, time: '12:00' }));
    await assertFails(reschedule(visitor, booking, from, { date, time: '18:00' }));
    await assertFails(reschedule(visitor, booking, from, { date: weekendAhead(3), time: '10:00' }));
    await assertFails(reschedule(visitor, booking, from, { date, time: '14:00' }, { updateManage: false }));
  });

  test('a stranger cannot move a booking or refresh its hold', async () => {
    const date = weekdayAhead(3);
    const booking = await book(visitor, date, '10:00');
    const from = { date, time: '10:00', duration: 30 };
    await assertFails(reschedule(stranger, booking, from, { date, time: '14:00' }, { manageId: token() }));
    // Re-writing an existing hold with a fresh timestamp (to keep it from expiring) is not allowed.
    await assertFails(setDoc(doc(stranger, 'slots', booking.cellIds[0]), {
      date, time: '10:00', bookingId: booking.bookingId, confirmed: false, createdAt: serverTimestamp()
    }));
  });
});

describe('custom questions', () => {
  test('meeting types can carry up to 5 questions', async () => {
    const question = { id: 'q1', label: 'Company', kind: 'short', required: true, options: [] };
    await assertSucceeds(saveType(admin, 'intro', { questions: [question] }));
    await assertFails(saveType(admin, 'too-many', { questions: Array(6).fill(question) }));
  });

  test('bookings can include up to 5 answers', async () => {
    const date = weekdayAhead(3);
    const answer = { label: 'Company', value: 'Acme' };
    await assertSucceeds(book(visitor, date, '10:00', { booking: { answers: [answer] } }));
    await assertFails(book(visitor, date, '11:00', { booking: { answers: Array(6).fill(answer) } }));
    await assertFails(book(visitor, date, '12:00', { booking: { answers: 'not a list' } }));
  });
});

describe('availability, busy blocks and config', () => {
  const open = { start: '07:00', end: '20:00' };
  const short = { start: '12:00', end: '14:00' };

  test('saved weekly hours and days off are enforced', async () => {
    const dayOff = weekdayAhead(6);
    await assertSucceeds(setDoc(doc(admin, 'config', 'availability'), {
      weekly: { 0: short, 1: open, 2: open, 3: open, 4: open, 5: open, 6: short },
      daysOff: [dayOff], bufferMinutes: 0, maxPerDay: 0
    }));
    const date = weekdayAhead(7);
    await assertSucceeds(book(visitor, date, '07:00'));
    await assertSucceeds(book(visitor, date, '19:30'));
    await assertFails(book(visitor, date, '20:00'));
    const weekend = weekendAhead(5);
    await assertSucceeds(book(visitor, weekend, '13:30'));
    await assertFails(book(visitor, weekend, '14:00'));
    await assertFails(book(visitor, dayOff, '10:00'));
  });

  test('a closed weekday rejects bookings', async () => {
    await setDoc(doc(admin, 'config', 'availability'), {
      weekly: { 0: null, 1: open, 2: open, 3: null, 4: open, 5: open, 6: null }, daysOff: [], bufferMinutes: 0, maxPerDay: 0
    });
    await assertFails(book(visitor, dayAhead(8, d => d === 3), '10:00'));
  });

  test('only the host writes config docs and busy blocks', async () => {
    await assertFails(setDoc(doc(visitor, 'config', 'availability'), { weekly: {}, daysOff: [] }));
    await assertFails(setDoc(doc(admin, 'config', 'other'), { x: 1 }));
    await assertSucceeds(setDoc(doc(admin, 'config', 'calendarSync'), { busyBlocks: 1 }));

    const block = { date: '2026-12-01', start: '15:00', end: '16:00', source: 'manual' };
    await assertSucceeds(setDoc(doc(admin, 'blocks', 'b1'), block));
    await assertSucceeds(getDocs(collection(visitor, 'blocks')));
    await assertFails(setDoc(doc(visitor, 'blocks', 'b2'), block));
    await assertFails(setDoc(doc(admin, 'blocks', 'b3'), { ...block, title: 'Dentist' }));
    await assertFails(setDoc(doc(admin, 'blocks', 'b4'), { ...block, start: '16:00', end: '15:00' }));
    await assertSucceeds(setDoc(doc(admin, 'blocks', 'b5'), { ...block, start: '23:00', end: '24:00', source: 'google' }));
    await assertFails(deleteDoc(doc(stranger, 'blocks', 'b1')));
  });
});
