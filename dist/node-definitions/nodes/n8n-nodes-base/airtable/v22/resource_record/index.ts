/**
 * Airtable - Record Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV22RecordCreateNode } from './operation_create';
import type { AirtableV22RecordDeleteRecordNode } from './operation_delete_record';
import type { AirtableV22RecordGetNode } from './operation_get';
import type { AirtableV22RecordSearchNode } from './operation_search';
import type { AirtableV22RecordUpdateNode } from './operation_update';
import type { AirtableV22RecordUpsertNode } from './operation_upsert';

export * from './operation_create';
export * from './operation_delete_record';
export * from './operation_get';
export * from './operation_search';
export * from './operation_update';
export * from './operation_upsert';

export type AirtableV22RecordNode =
  | AirtableV22RecordCreateNode
  | AirtableV22RecordDeleteRecordNode
  | AirtableV22RecordGetNode
  | AirtableV22RecordSearchNode
  | AirtableV22RecordUpdateNode
  | AirtableV22RecordUpsertNode
  ;