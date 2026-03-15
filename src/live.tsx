import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LiveApp from './LiveApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveApp />
  </StrictMode>,
);
