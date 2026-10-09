import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import Manage from './Manage.jsx';
import './index.css';

// Hash routes: #admin is the host's page, #manage/<token> is a booker's private booking page,
// everything else is the public booking page.
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

  if (hash === '#admin') return <Admin />;

  const manageMatch = hash.match(/^#manage\/([a-f0-9]{32})$/);
  if (manageMatch) return <Manage key={manageMatch[1]} token={manageMatch[1]} />;

  return <App />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
