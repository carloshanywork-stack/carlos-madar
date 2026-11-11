/**
 * Airtable Node - Version 2
 * Re-exports all discriminator combinations.
 */

import type { AirtableV2BaseNode } from './resource_base';
import type { AirtableV2RecordNode } from './resource_record';

export * from './resource_base';
export * from './resource_record';

export type AirtableV2Node =
  | AirtableV2BaseNode
  | AirtableV2RecordNode
  ;