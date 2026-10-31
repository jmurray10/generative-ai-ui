import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Showcases } from './showcases/Showcases';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/showcases') ? <Showcases /> : <App />}
  </React.StrictMode>,
);
