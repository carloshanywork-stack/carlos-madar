/** Lightweight in-process event fan-out for the single-process SQLite deployment. */
const subscribers = new Set();
let sequence = 0;

export function subscribeOperationsEvents(listener) {
  if (typeof listener !== 'function') throw new TypeError('An event listener is required.');
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function publishOperationsEvent(type, details = {}) {
  if (typeof type !== 'string' || !type.trim()) throw new TypeError('An event type is required.');
  const event = Object.freeze({
    ...details,
    id: `${Date.now()}-${++sequence}`,
    type,
    occurredAt: new Date().toISOString(),
  });
  for (const listener of subscribers) {
    try {
      listener(event);
    } catch {
      subscribers.delete(listener);
    }
  }
  return event;
}
