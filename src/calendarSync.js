import { busyIntervalsToBlocks, MAX_DAYS_AHEAD } from './booking.js';

// Only busy/free times. Event titles, guests and details are never requested.
const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

// Asks Google for a Calendar access token with a popup. It must be called from a click, or the
// browser blocks the popup. Tokens last about an hour, so the caller keeps it for repeat syncs.
export const requestCalendarAccess = async (services, email) => {
  const provider = new services.GoogleAuthProvider();
  provider.addScope(FREEBUSY_SCOPE);
  provider.setCustomParameters({ login_hint: email });

  const result = await services.signInWithPopup(services.auth, provider);
  const accessToken = services.GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!accessToken) throw new Error('Google did not return calendar access.');
  return { accessToken, expiresAt: Date.now() + 55 * 60 * 1000 };
};

const fetchBusyIntervals = async (accessToken) => {
  const now = Date.now();
  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(now).toISOString(),
      timeMax: new Date(now + (MAX_DAYS_AHEAD + 1) * 24 * 60 * 60 * 1000).toISOString(),
      items: [{ id: 'primary' }]
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `Google Calendar returned ${response.status}`);
    error.status = response.status;
    error.reason = body.error?.errors?.[0]?.reason;
    throw error;
  }
  const calendarErrors = body.calendars?.primary?.errors;
  if (calendarErrors?.length) throw new Error(`Google Calendar: ${calendarErrors[0].reason}`);
  return body.calendars?.primary?.busy || [];
};

// Replaces every Google-sourced block with the current busy times. Manual blocks are left alone.
export const syncGoogleCalendar = async (services, accessToken) => {
  const blocks = busyIntervalsToBlocks(await fetchBusyIntervals(accessToken));
  const blocksRef = services.collection(services.db, 'blocks');
  const old = await services.getDocs(services.query(blocksRef, services.where('source', '==', 'google')));

  const writes = [
    ...old.docs.map(snapshotDoc => batch => batch.delete(snapshotDoc.ref)),
    ...blocks.map(block => batch => batch.set(services.doc(blocksRef), { ...block, source: 'google' })),
    batch => batch.set(services.doc(services.db, 'config', 'calendarSync'), {
      lastSyncedAt: services.serverTimestamp(),
      busyBlocks: blocks.length
    })
  ];

  // Firestore batches hold at most 500 writes.
  for (let i = 0; i < writes.length; i += 450) {
    const batch = services.writeBatch(services.db);
    writes.slice(i, i + 450).forEach(write => write(batch));
    await batch.commit();
  }
  return blocks.length;
};

// Turns Google API failures into instructions the host can act on.
export const describeSyncError = (error) => {
  if (error.code === 'auth/popup-blocked') return 'The browser blocked the Google popup. Allow popups for this site and try again.';
  if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return 'Google sign-in was closed before finishing.';
  if (error.reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(error.message)) {
    return 'The Google Calendar API is not enabled for this Firebase project. Enable it (see README > Google Calendar sync) and try again.';
  }
  if (error.status === 401) return 'Google access expired. Click Sync again.';
  if (error.status === 403) return "Google didn't grant calendar access. Click Sync again and allow \"See your free/busy\".";
  return `Calendar sync failed: ${error.message}`;
};
