import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { detectRuntime } from './data/runtime';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Decide demo vs. Gmail before the store is created, so the right provider is in place.
detectRuntime().then(async (rt) => {
  if (rt.auth && !rt.user) {
    const { SignIn } = await import('./app/SignIn');
    createRoot(root).render(
      <StrictMode>
        <SignIn />
      </StrictMode>,
    );
    return;
  }
  const { App } = await import('./app/App');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
