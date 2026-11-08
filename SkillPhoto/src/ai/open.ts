/**
 * Open / close state of the assistant drawer, without React, so menu commands in core code
 * can open it. Shared copy — keep identical in all three apps.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let isOpen = false;
let pending: string | null = null;
const emit = () => listeners.forEach((l) => l());

export const subscribeAssistant = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const assistantOpen = () => isOpen;

/** Opens the drawer; with a prompt, sends it right away. */
export function openAssistant(prompt?: string) {
  isOpen = true;
  if (prompt) pending = prompt;
  emit();
}
export function closeAssistant() {
  isOpen = false;
  emit();
}
export function toggleAssistant() {
  isOpen = !isOpen;
  emit();
}
/** The prompt queued by openAssistant(prompt), taken once. */
export function takePendingPrompt(): string | null {
  const p = pending;
  pending = null;
  return p;
}
