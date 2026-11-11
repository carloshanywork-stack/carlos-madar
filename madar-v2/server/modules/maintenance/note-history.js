import { HttpError, positiveId } from '../http.js';

export function formatMachineNoteDate(value) {
  if (!value) return '';
  const source = String(value);
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(source)
    ? `${source.replace(' ', 'T')}Z`
    : source;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return source;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getMachineNotesHistory(machineId, database) {
  const id = positiveId(machineId, 'machineId');
  const machine = database.prepare('SELECT id FROM machines WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!machine) throw new HttpError(404, 'Machine was not found.');

  return database.prepare(`
    SELECT history.id, history.machine_id, history.card_id, history.order_id,
      history.author_id, history.author_name, history.author_role, history.note,
      history.created_at, COALESCE(order_record.order_code, '') AS order_code
    FROM machine_notes_history history
    LEFT JOIN maintenance_orders order_record ON order_record.id = history.order_id
    WHERE history.machine_id = ?
    ORDER BY datetime(history.created_at) DESC, history.id DESC
  `).all(id).map((entry) => ({
    ...entry,
    formatted_date: formatMachineNoteDate(entry.created_at),
  }));
}
