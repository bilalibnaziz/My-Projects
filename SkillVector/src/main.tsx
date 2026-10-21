import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import App from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import { COMMANDS } from './core/commands';
import { store } from './core/store';
import * as ops from './core/ops';

// Expose handle for automated checks and macOS native menu integration
(window as unknown as Record<string, unknown>).__ps = { store, ops, commands: COMMANDS };
(window as unknown as Record<string, unknown>).__skillSuite = {
  runCommand: (id: string) => {
    const c = COMMANDS.find((cmd) => cmd.id === id);
    if (c) {
      if (!c.enabled || c.enabled()) {
        c.run();
        return true;
      }
    }
    return false;
  },
};
