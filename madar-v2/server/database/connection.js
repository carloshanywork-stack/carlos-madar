import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { databasePath } from '../config/paths.js';

export function createConnection(filePath = databasePath) {
  if (filePath !== ':memory:' && !filePath.startsWith('file:')) {
    const directory = isAbsolute(filePath) ? dirname(filePath) : dirname(resolve(filePath));
    mkdirSync(directory, { recursive: true });
  }

  const connection = new Database(filePath);
  connection.pragma('foreign_keys = ON');
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('busy_timeout = 5000');
  return connection;
}

export const db = createConnection();

/** Run a synchronous callback atomically, rolling back if it throws. */
export function transaction(callback, ...args) {
  if (typeof callback !== 'function') {
    throw new TypeError('transaction() requires a callback.');
  }

  const run = db.transaction((...callbackArgs) => {
    const result = callback(...callbackArgs);
    if (result && typeof result.then === 'function') {
      throw new TypeError('SQLite transactions must use a synchronous callback.');
    }
    return result;
  });

  return run(...args);
}
