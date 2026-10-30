import { db } from '../../database/connection.js';
import { HttpError, requireText } from '../http.js';

const DEPARTMENTS = ['Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration'];

export function listEmployees(department, database = db) {
  const parameters = [];
  let filter = '';
  if (department !== undefined && department !== '') {
    const normalized = requireText(department, 'department', { maxLength: 80 });
    if (!DEPARTMENTS.includes(normalized)) {
      throw new HttpError(400, `department must be one of: ${DEPARTMENTS.join(', ')}.`);
    }
    filter = 'AND department = ?';
    parameters.push(normalized);
  }
  return database.prepare(`
    SELECT id, name, department, job_title, phone, active
    FROM employees
    WHERE active = 1 AND deleted_at IS NULL ${filter}
    ORDER BY department, name COLLATE NOCASE, id
  `).all(...parameters);
}
