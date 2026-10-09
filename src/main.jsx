import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import Manage from './Manage.jsx';
import './index.css';

// Hash routes:
//   #admin                          host dashboard
//   #admin/review/<id>[/confirm|decline]   one booking, from the links in the host's email
//   #manage/<token>                 a guest's private booking page
//   #book/<type>                    booking page for one meeting type
//   anything else                   booking page (single type) or the meeting type picker
function Root() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const reviewMatch = hash.match(/^#admin\/review\/([A-Za-z0-9]+)(?:\/(confirm|decline))?$/);
  if (hash === '#admin' || reviewMatch) {
    return <Admin review={reviewMatch ? { bookingId: reviewMatch[1], action: reviewMatch[2] } : null} />;
  }

  const manageMatch = hash.match(/^#manage\/([a-f0-9]{32})$/);
  if (manageMatch) return <Manage key={manageMatch[1]} token={manageMatch[1]} />;

  const typeMatch = hash.match(/^#book\/([a-z0-9-]+)$/);
  return <App key={typeMatch?.[1] || 'home'} typeSlug={typeMatch?.[1]} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
