/**
 * Airtable - Base Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV21BaseGetManyNode } from './operation_get_many';
import type { AirtableV21BaseGetSchemaNode } from './operation_get_schema';

export * from './operation_get_many';
export * from './operation_get_schema';

export type AirtableV21BaseNode =
  | AirtableV21BaseGetManyNode
  | AirtableV21BaseGetSchemaNode
  ;