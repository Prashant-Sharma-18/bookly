import { useEffect, useState } from 'react';
import { getFirebaseServices, hasFirebaseConfig } from './firebase.js';
import { DEFAULT_AVAILABILITY, DEFAULT_EVENT_TYPE, normalizeAvailability } from './booking.js';

// Live public data needed to show open times: taken half-hour cells, the host's availability,
// busy blocks and meeting types. Used by the booking page and the guest's reschedule screen.
export default function useBookingData({ localCells = null } = {}) {
  const [cells, setCells] = useState(localCells ?? []);
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY);
  const [blocks, setBlocks] = useState([]);
  const [eventTypes, setEventTypes] = useState(hasFirebaseConfig ? null : [DEFAULT_EVENT_TYPE]);
  const [loading, setLoading] = useState(hasFirebaseConfig);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!hasFirebaseConfig) return;

    const unsubscribers = [];
    let isMounted = true;

    getFirebaseServices()
      .then((services) => {
        if (!isMounted) return;
        const watch = (ref, onData, onError = (err) => console.error('Firestore Error:', err)) => {
          unsubscribers.push(services.onSnapshot(ref, onData, onError));
        };

        // The host's working hours, days off, buffer and daily limit (admin Settings tab).
        watch(services.doc(services.db, 'config', 'availability'), (snapshot) => setAvailability(normalizeAvailability(snapshot.data())));

        // Busy times: manual blocks + Google Calendar sync.
        watch(services.collection(services.db, 'blocks'), (snapshot) => setBlocks(snapshot.docs.map(d => d.data())));

        // Until the host saves their own meeting types, the default 30-minute one is offered.
        watch(
          services.collection(services.db, 'eventTypes'),
          (snapshot) => setEventTypes(snapshot.empty
            ? [DEFAULT_EVENT_TYPE]
            : snapshot.docs.map(d => ({ ...DEFAULT_EVENT_TYPE, id: d.id, ...d.data() }))),
          (err) => {
            console.error('Firestore Error:', err);
            setEventTypes([DEFAULT_EVENT_TYPE]);
          }
        );

        // Taken half-hour cells. Public, with no personal details.
        watch(
          services.collection(services.db, 'slots'),
          (snapshot) => {
            setCells(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setError('');
            setLoading(false);
          },
          (err) => {
            console.error('Firestore Error:', err);
            setError('Unable to load availability. Please refresh and try again.');
            setLoading(false);
          }
        );
      })
      .catch((err) => {
        console.error('Firestore Setup Error:', err);
        if (!isMounted) return;
        setError('Unable to load availability. Please refresh and try again.');
        setEventTypes([DEFAULT_EVENT_TYPE]);
        setLoading(false);
      });

    return () => {
      isMounted = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  return { cells, setCells, availability, blocks, eventTypes, loading: loading || eventTypes === null, error };
}
