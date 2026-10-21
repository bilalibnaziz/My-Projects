import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fx/ui/styles.css';
import EffectsScaleApp from './fx/ui/EffectsScaleApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EffectsScaleApp />
  </StrictMode>
);

// Dev-only handle for debugging from the console / automated checks
if (import.meta.env.DEV) {
  Promise.all([import('./fx/store'), import('./fx/audioEngine')]).then(([s, a]) => {
    (window as unknown as Record<string, unknown>).__effectsScale = {
      store: s.fxStore,
      audio: a.audioEngine,
    };
  });
}
