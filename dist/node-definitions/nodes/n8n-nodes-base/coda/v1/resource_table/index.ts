/**
 * Coda - Table Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV1TableCreateRowNode } from './operation_create_row';
import type { CodaV1TableDeleteRowNode } from './operation_delete_row';
import type { CodaV1TableGetAllColumnsNode } from './operation_get_all_columns';
import type { CodaV1TableGetAllRowsNode } from './operation_get_all_rows';
import type { CodaV1TableGetColumnNode } from './operation_get_column';
import type { CodaV1TableGetRowNode } from './operation_get_row';
import type { CodaV1TablePushButtonNode } from './operation_push_button';

export * from './operation_create_row';
export * from './operation_delete_row';
export * from './operation_get_all_columns';
export * from './operation_get_all_rows';
export * from './operation_get_column';
export * from './operation_get_row';
export * from './operation_push_button';

export type CodaV1TableNode =
  | CodaV1TableCreateRowNode
  | CodaV1TableDeleteRowNode
  | CodaV1TableGetAllColumnsNode
  | CodaV1TableGetAllRowsNode
  | CodaV1TableGetColumnNode
  | CodaV1TableGetRowNode
  | CodaV1TablePushButtonNode
  ;