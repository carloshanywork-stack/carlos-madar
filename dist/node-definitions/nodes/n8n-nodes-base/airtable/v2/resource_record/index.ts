/**
 * Airtable - Record Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV2RecordCreateNode } from './operation_create';
import type { AirtableV2RecordDeleteRecordNode } from './operation_delete_record';
import type { AirtableV2RecordGetNode } from './operation_get';
import type { AirtableV2RecordSearchNode } from './operation_search';
import type { AirtableV2RecordUpdateNode } from './operation_update';
import type { AirtableV2RecordUpsertNode } from './operation_upsert';

export * from './operation_create';
export * from './operation_delete_record';
export * from './operation_get';
export * from './operation_search';
export * from './operation_update';
export * from './operation_upsert';

export type AirtableV2RecordNode =
  | AirtableV2RecordCreateNode
  | AirtableV2RecordDeleteRecordNode
  | AirtableV2RecordGetNode
  | AirtableV2RecordSearchNode
  | AirtableV2RecordUpdateNode
  | AirtableV2RecordUpsertNode
  ;