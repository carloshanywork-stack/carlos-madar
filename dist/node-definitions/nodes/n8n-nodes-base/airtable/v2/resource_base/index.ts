/**
 * Airtable - Base Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtableV2BaseGetManyNode } from './operation_get_many';
import type { AirtableV2BaseGetSchemaNode } from './operation_get_schema';

export * from './operation_get_many';
export * from './operation_get_schema';

export type AirtableV2BaseNode =
  | AirtableV2BaseGetManyNode
  | AirtableV2BaseGetSchemaNode
  ;