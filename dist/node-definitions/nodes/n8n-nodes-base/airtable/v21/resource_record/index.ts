/**
 * Airtable - Record Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV21RecordCreateNode } from './operation_create';
import type { AirtableV21RecordDeleteRecordNode } from './operation_delete_record';
import type { AirtableV21RecordGetNode } from './operation_get';
import type { AirtableV21RecordSearchNode } from './operation_search';
import type { AirtableV21RecordUpdateNode } from './operation_update';
import type { AirtableV21RecordUpsertNode } from './operation_upsert';

export * from './operation_create';
export * from './operation_delete_record';
export * from './operation_get';
export * from './operation_search';
export * from './operation_update';
export * from './operation_upsert';

export type AirtableV21RecordNode =
  | AirtableV21RecordCreateNode
  | AirtableV21RecordDeleteRecordNode
  | AirtableV21RecordGetNode
  | AirtableV21RecordSearchNode
  | AirtableV21RecordUpdateNode
  | AirtableV21RecordUpsertNode
  ;