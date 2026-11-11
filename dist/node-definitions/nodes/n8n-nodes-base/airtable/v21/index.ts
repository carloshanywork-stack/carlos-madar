/**
 * Airtable Node - Version 2.1
 * Re-exports all discriminator combinations.
 */

import type { AirtableV21BaseNode } from './resource_base';
import type { AirtableV21RecordNode } from './resource_record';

export * from './resource_base';
export * from './resource_record';

export type AirtableV21Node =
  | AirtableV21BaseNode
  | AirtableV21RecordNode
  ;