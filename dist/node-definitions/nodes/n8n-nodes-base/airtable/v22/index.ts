/**
 * Airtable Node - Version 2.2
 * Re-exports all discriminator combinations.
 */

import type { AirtableV22BaseNode } from './resource_base';
import type { AirtableV22RecordNode } from './resource_record';

export * from './resource_base';
export * from './resource_record';

export type AirtableV22Node =
  | AirtableV22BaseNode
  | AirtableV22RecordNode
  ;