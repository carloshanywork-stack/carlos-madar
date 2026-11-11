/**
 * Airtable - Base Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV22BaseGetManyNode } from './operation_get_many';
import type { AirtableV22BaseGetSchemaNode } from './operation_get_schema';

export * from './operation_get_many';
export * from './operation_get_schema';

export type AirtableV22BaseNode =
  | AirtableV22BaseGetManyNode
  | AirtableV22BaseGetSchemaNode
  ;