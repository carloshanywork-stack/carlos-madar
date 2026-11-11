/**
 * Coda - Table Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV11TableCreateRowNode } from './operation_create_row';
import type { CodaV11TableDeleteRowNode } from './operation_delete_row';
import type { CodaV11TableGetAllColumnsNode } from './operation_get_all_columns';
import type { CodaV11TableGetAllRowsNode } from './operation_get_all_rows';
import type { CodaV11TableGetColumnNode } from './operation_get_column';
import type { CodaV11TableGetRowNode } from './operation_get_row';
import type { CodaV11TablePushButtonNode } from './operation_push_button';

export * from './operation_create_row';
export * from './operation_delete_row';
export * from './operation_get_all_columns';
export * from './operation_get_all_rows';
export * from './operation_get_column';
export * from './operation_get_row';
export * from './operation_push_button';

export type CodaV11TableNode =
  | CodaV11TableCreateRowNode
  | CodaV11TableDeleteRowNode
  | CodaV11TableGetAllColumnsNode
  | CodaV11TableGetAllRowsNode
  | CodaV11TableGetColumnNode
  | CodaV11TableGetRowNode
  | CodaV11TablePushButtonNode
  ;