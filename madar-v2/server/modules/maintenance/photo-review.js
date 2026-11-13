import { createHash } from 'node:crypto';
import { db } from '../../database/connection.js';
import { HttpError, allowOnlyKeys, optionalText, positiveId, requireObject } from '../http.js';
import { recordAudit } from '../audit.js';

export function photoLists(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function photoHash(card) {
  return createHash('sha256').update(JSON.stringify([photoLists(card.before_photos_json), photoLists(card.after_photos_json)])).digest('hex');
}

// Renames preserve image bytes and the approval decision, but invalidate stale review screens.
export function reconcileCardPhotoReviewPaths(cardId, database = db) {
  const card = database.prepare('SELECT before_photos_json, after_photos_json FROM maintenance_cards WHERE id = ?').get(cardId);
  const review = database.prepare('SELECT content_hash FROM maintenance_card_photo_reviews WHERE card_id = ?').get(cardId);
  if (!card || !review) return;
  const hash = photoHash(card);
  if (hash !== review.content_hash) database.prepare('UPDATE maintenance_card_photo_reviews SET content_hash = ?, revision = revision + 1 WHERE card_id = ?').run(hash, cardId);
}

export function assertNoPendingRepPhotoReview(cardId, database = db) {
  if (database.prepare(`SELECT 1 FROM rep_visits visit LEFT JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE visit.card_id = ? AND (visit.status = 'receiving' OR (visit.status = 'completed' AND review.status = 'pending')) LIMIT 1`).get(cardId)) {
    throw new HttpError(409, 'Representative photos are pending review. Review them before changing this card photo set.');
  }
}

// Called inside the same transaction as each manual photo-list mutation.
export function queueCardPhotoReview(cardId, actorId, database = db) {
  const card = database.prepare(`SELECT card.*, order_record.status AS order_status
    FROM maintenance_cards card JOIN maintenance_orders order_record ON order_record.id = card.order_id
    WHERE card.id = ? AND card.deleted_at IS NULL AND order_record.deleted_at IS NULL`).get(cardId);
  if (!card || card.status === 'excluded') return;
  if (card.order_status === 'archived') throw new HttpError(409, 'Archived maintenance orders do not allow photo changes.');
  assertNoPendingRepPhotoReview(cardId, database);
  const previous = database.prepare('SELECT * FROM maintenance_card_photo_reviews WHERE card_id = ?').get(cardId);
  const contentHash = photoHash(card);
  if (previous?.content_hash === contentHash && previous.status !== 'superseded') {
    database.prepare('UPDATE maintenance_cards SET status = ? WHERE id = ?')
      .run(previous.status === 'approved' ? 'completed' : 'pending', cardId);
    return;
  }
  const before = photoLists(card.before_photos_json), after = photoLists(card.after_photos_json);
  const status = before.length || after.length ? 'pending' : 'empty';
  database.prepare(`INSERT INTO maintenance_card_photo_reviews
      (card_id, status, revision, content_hash, submitted_by, provenance)
    VALUES (?, ?, 1, ?, ?, 'upload')
    ON CONFLICT(card_id) DO UPDATE SET status = excluded.status, revision = revision + 1,
      content_hash = excluded.content_hash, submitted_by = excluded.submitted_by, submitted_at = CURRENT_TIMESTAMP,
      reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, provenance = 'upload'`)
    .run(cardId, status, contentHash, actorId);
  database.prepare("UPDATE maintenance_cards SET status = 'pending' WHERE id = ?").run(cardId);
  database.prepare('DELETE FROM rep_machine_work_leases WHERE card_id = ?').run(cardId);
  recordAudit({ database, actorId, action: 'submit_card_photos_for_review', entityType: 'maintenance_card', entityId: cardId,
    oldValues: previous ? { status: previous.status, revision: previous.revision } : null,
    newValues: { status, revision: (previous?.revision || 0) + 1, before_count: before.length, after_count: after.length } });
}

export function getPendingCardPhotoReviews(database = db) {
  return database.prepare(`SELECT review.*, card.order_id, card.machine_id, card.before_photos_json,
      card.after_photos_json, card.notes, card.reason_ids_json, card.reason_id, order_record.order_code,
      machine.code AS machine_code, machine.name_ar AS machine_name, machine.area, uploader.full_name AS uploader_name
    FROM maintenance_card_photo_reviews review JOIN maintenance_cards card ON card.id = review.card_id
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id LEFT JOIN users uploader ON uploader.id = review.submitted_by
    WHERE review.status = 'pending' AND card.deleted_at IS NULL AND card.status != 'excluded'
      AND order_record.deleted_at IS NULL AND order_record.status != 'archived' AND machine.deleted_at IS NULL
    ORDER BY review.submitted_at, review.card_id`).all().map((row) => {
    const photo = (phase, path) => {
      const url = `/api/maintenance/orders/${row.order_id}/cards/${row.card_id}/photos/${phase}/${encodeURIComponent(path.split('/').at(-1))}`;
      return { url, thumbnailUrl: `${url}/thumbnail`, capturedAt: null };
    };
    const ids = photoLists(row.reason_ids_json); if (!ids.length && row.reason_id) ids.push(row.reason_id);
    const beforePhotos = photoLists(row.before_photos_json).map((p) => photo('before', p));
    const afterPhotos = photoLists(row.after_photos_json).map((p) => photo('after', p));
    return { id: -Number(row.card_id), source: 'office', cardId: Number(row.card_id), revision: Number(row.revision),
      orderId: Number(row.order_id), machineId: Number(row.machine_id), orderCode: row.order_code,
      machineCode: row.machine_code, machineName: row.machine_name, regionName: row.area,
      repName: row.uploader_name || 'رفع من السيستم', repId: null, machineCondition: 'working',
      reasonIds: ids, reasonNames: ids.map((id) => database.prepare('SELECT name FROM maintenance_reasons WHERE id = ?').get(id)?.name).filter(Boolean),
      maintenanceLines: database.prepare(`SELECT reason_id AS reasonId, reason_label_snapshot AS label, quantity,
        unit_snapshot AS unit FROM maintenance_card_lines WHERE card_id = ? ORDER BY id`).all(row.card_id),
      notes: row.notes || '', capturedAt: row.submitted_at, siteDurationSeconds: null,
      beforePhotos, afterPhotos, beforePhotoUrl: beforePhotos[0]?.url || null, afterPhotoUrl: afterPhotos[0]?.url || null };
  });
}

export function reviewCardPhotos(cardIdValue, input, actorId, database = db) {
  const cardId = positiveId(cardIdValue, 'cardId'), body = requireObject(input);
  allowOnlyKeys(body, ['action', 'note', 'revision']);
  if (!['approve', 'reshoot'].includes(body.action)) throw new HttpError(400, 'action must be approve or reshoot.');
  const revision = positiveId(body.revision, 'revision');
  const note = optionalText(body.note, 'note', { maxLength: 1000 });
  if (body.action === 'reshoot' && !note) throw new HttpError(400, 'A note is required for reshooting.');
  return database.transaction(() => {
    const actor = database.prepare('SELECT role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(actorId);
    if (actor?.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
    const row = database.prepare(`SELECT review.*, card.before_photos_json, card.after_photos_json,
      card.order_id, card.deleted_at, card.status AS card_status, order_record.status AS order_status,
      order_record.deleted_at AS order_deleted_at FROM maintenance_card_photo_reviews review
      JOIN maintenance_cards card ON card.id = review.card_id
      JOIN maintenance_orders order_record ON order_record.id = card.order_id WHERE card.id = ?`).get(cardId);
    if (!row || row.deleted_at || row.order_deleted_at) throw new HttpError(404, 'Photo review was not found.');
    if (row.order_status === 'archived' || row.card_status === 'excluded') throw new HttpError(409, 'This card cannot be reviewed.');
    if (row.revision !== revision || (row.content_hash && row.content_hash !== photoHash(row))) throw new HttpError(409, 'Photos changed. Refresh the review queue before approving.');
    if (row.status === 'approved' && body.action === 'approve') return { success: true, status: 'approved', cardId, idempotent: true };
    if (row.status !== 'pending') throw new HttpError(409, 'These photos are no longer pending review.');
    if (!photoLists(row.before_photos_json).length && !photoLists(row.after_photos_json).length) throw new HttpError(409, 'No photos remain on this card.');
    assertNoPendingRepPhotoReview(cardId, database);
    const status = body.action === 'approve' ? 'approved' : 'reshoot';
    database.prepare(`UPDATE maintenance_card_photo_reviews SET status = ?, review_note = ?, reviewed_by = ?,
      reviewed_at = CURRENT_TIMESTAMP WHERE card_id = ? AND revision = ?`).run(status, note, actorId, cardId, revision);
    database.prepare('UPDATE maintenance_cards SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status === 'approved' ? 'completed' : 'pending', cardId);
    recordAudit({ database, actorId, action: status === 'approved' ? 'approve_card_photos' : 'request_card_reshoot',
      entityType: 'maintenance_card', entityId: cardId, oldValues: { status: row.status, revision }, newValues: { status, revision, note } });
    const recipientUserIds = database.prepare('SELECT user_id FROM maintenance_order_reps WHERE order_id = ?').all(row.order_id).map((r) => Number(r.user_id));
    return { success: true, status: status === 'approved' ? 'approved' : 'reshoot_requested', cardId, recipientUserIds, idempotent: false };
  }).immediate();
}
