import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readdirSync,readFileSync,unlinkSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import { db } from '../database/connection.js';
import { materializeNotificationsForEvent } from './notifications/service.js';

/** Durable SQLite event log with in-process fan-out for the single-process deployment. */
const subscribers = new Set();

const MAX_REPLAY_EVENTS = 10_000;

function deserializeEvent(row) {
  const payload = JSON.parse(row.payload_json);
  return Object.freeze({
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload }),
    id: Number(row.event_id),
    type: row.event_type,
    occurredAt: row.occurred_at,
  });
}

export function subscribeOperationsEvents(listener) {
  if (typeof listener !== 'function') throw new TypeError('An event listener is required.');
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function getOperationsEventsAfter(eventId = 0, { limit = 1000, database = db } = {}) {
  const cursor = Number(eventId);
  const count = Number(limit);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('An event cursor must be a non-negative safe integer.');
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('An event replay limit must be a positive safe integer.');
  const boundedLimit = Math.min(count, MAX_REPLAY_EVENTS);
  return database.prepare(`
    SELECT event_id, event_type, payload_json, occurred_at
    FROM operations_events
    WHERE event_id > ? AND event_type <> 'system.shutdown'
    ORDER BY event_id
    LIMIT ?
  `).all(cursor, boundedLimit).map(deserializeEvent);
}

export function getOperationsReplayCursor(value, database = db) {
  const cursor=Number(value);
  const range=database.prepare('SELECT MIN(event_id) AS first, MAX(event_id) AS last FROM operations_events').get();
  const valid=Number.isSafeInteger(cursor)&&cursor>=0;
  const gap=!valid || cursor>Number(range.last??0) || (cursor>0&&range.first!=null&&cursor<Number(range.first)-1);
  return {cursor:gap?0:cursor,reconcile:gap};
}

function dispatch(event) {
  for (const listener of subscribers) {try {listener(event);} catch {subscribers.delete(listener);}}
  return event;
}
function persistPublication(database, publication, { strictNotifications = false } = {}) {
  database.prepare(`INSERT OR IGNORE INTO operations_events(event_type,payload_json,occurred_at,publication_key) VALUES (?,?,?,?)`)
    .run(publication.type,JSON.stringify(publication.details),publication.occurredAt,publication.key);
  const row=database.prepare('SELECT event_id,event_type,payload_json,occurred_at FROM operations_events WHERE publication_key=?').get(publication.key);
  const event=deserializeEvent(row);
  try {
    materializeNotificationsForEvent(event, database);
  } catch (error) {
    if (strictNotifications) throw error;
    // The durable event remains the source of truth; never block fan-out because
    // an inbox row could not be written.
    console.error('Notification inbox persistence failed:', error.message);
  }
  return event;
}
function outboxPath(database) {
  if(!database.name || database.name===':memory:')throw new Error('No durable database directory available for the event outbox');
  return join(dirname(resolve(database.name)),'operations-outbox');
}
/** Enqueue inside the business transaction; a rollback also removes its publication intent. */
export function enqueueOperationsEvent(type, details = {}, database = db) {
  if (!database.inTransaction) throw new Error('Business event enqueue requires an active transaction.');
  if (typeof type !== 'string' || !type.trim()) throw new TypeError('An event type is required.');
  database.prepare(`INSERT INTO operations_event_outbox(publication_key,event_type,payload_json,occurred_at)
    VALUES (?,?,?,?)`).run(randomUUID(), type, JSON.stringify(details), new Date().toISOString());
}

function flushTransactionalEvents(database) {
  if (database.inTransaction) return 0; // Never dispatch uncommitted changes.
  let delivered = 0;
  const rows = database.prepare('SELECT * FROM operations_event_outbox ORDER BY occurred_at LIMIT 1000').all();
  for (const row of rows) {
    // A coalesced reconciliation intent receives a fresh publication identity each delivery.
    const publication = {key: row.publication_key === 'maintenance.reconcile' ? randomUUID() : row.publication_key,
      type: row.event_type, details: JSON.parse(row.payload_json), occurredAt: row.occurred_at};
    const event = database.transaction(() => {
      const persisted = persistPublication(database, publication, { strictNotifications: true });
      database.prepare('DELETE FROM operations_event_outbox WHERE publication_key=?').run(row.publication_key);
      return persisted;
    }).immediate();
    dispatch(event); delivered++;
  }
  if (delivered) database.prepare(`DELETE FROM operations_events WHERE event_id < (SELECT event_id FROM operations_events ORDER BY event_id DESC LIMIT 1 OFFSET ?)`).run(MAX_REPLAY_EVENTS-1);
  return delivered;
}
export function flushPendingOperationsEvents(database=db) {
  if(!database.open)return {delivered:0};
  let transactionalDelivered;
  try { transactionalDelivered=flushTransactionalEvents(database); }
  catch(error) { console.error('Transactional event delivery pending:', error.message); return {delivered:0,error:error.message}; }
  let root;let files;
  try {root=outboxPath(database);files=readdirSync(root).filter(name=>/^\d+-[0-9a-f-]+\.json$/.test(name)).sort().slice(0,200);}
  catch(error) {if(error.code==='ENOENT')return {delivered:transactionalDelivered};return {delivered:transactionalDelivered,error:error.message};}
  let delivered=transactionalDelivered;
  for(const name of files) {
    try {
      const file=join(root,name);const publication=JSON.parse(readFileSync(file,'utf8'));
      if(typeof publication.key!=='string'||typeof publication.type!=='string'||!publication.details)throw new Error('Malformed event outbox entry');
      const event=persistPublication(database,publication);
      unlinkSync(file);dispatch(event);delivered++;
    } catch(error) {console.error('Operations outbox delivery is pending:',error.message);return {delivered,error:error.message};}
  }
  return {delivered};
}
export function startOperationsOutboxScheduler(database=db) {
  flushPendingOperationsEvents(database);
  const timer=setInterval(()=>flushPendingOperationsEvents(database),5000);timer.unref?.();
  return ()=>clearInterval(timer);
}
export function publishOperationsEvent(type, details = {}, database = db) {
  if(typeof type!=='string'||!type.trim())throw new TypeError('An event type is required.');
  const publication={key:randomUUID(),type,details,occurredAt:new Date().toISOString()};
  try {
    const event=persistPublication(database,publication);
    if(event.id%250===0)database.prepare(`DELETE FROM operations_events WHERE event_id < (SELECT event_id FROM operations_events ORDER BY event_id DESC LIMIT 1 OFFSET ?)`).run(MAX_REPLAY_EVENTS-1);
    return dispatch(event);
  } catch(error) {
    try {
      const root=outboxPath(database);mkdirSync(root,{recursive:true,mode:0o700});
      const filename=join(root,`${Date.now()}-${publication.key}.json`);const temporary=filename+'.tmp';
      writeFileSync(temporary,JSON.stringify(publication),{flag:'wx',mode:0o600});
      const fd=openSync(temporary,'r');try {fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary,filename);
      const directory=openSync(root,'r');try {fsyncSync(directory);}finally{closeSync(directory);}
    } catch(outboxError) {console.error('ALERT: operations event persistence and outbox failed; reconcile authoritative state:',outboxError.message);}
    console.error('Operations publication deferred; clients must reconcile:',error.message);
    // A reconciliation control frame has no durable cursor. Never advance a client to an invented ID.
    return dispatch(Object.freeze({...details,id:null,type:'system.reconcile-required',eventType:type,occurredAt:publication.occurredAt,transient:true}));
  }
}
