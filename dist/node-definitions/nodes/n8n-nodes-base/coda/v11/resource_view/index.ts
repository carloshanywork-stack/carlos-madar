/**
 * Coda - View Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV11ViewDeleteViewRowNode } from './operation_delete_view_row';
import type { CodaV11ViewGetNode } from './operation_get';
import type { CodaV11ViewGetAllNode } from './operation_get_all';
import type { CodaV11ViewGetAllViewColumnsNode } from './operation_get_all_view_columns';
import type { CodaV11ViewGetAllViewRowsNode } from './operation_get_all_view_rows';
import type { CodaV11ViewPushViewButtonNode } from './operation_push_view_button';
import type { CodaV11ViewUpdateViewRowNode } from './operation_update_view_row';

export * from './operation_delete_view_row';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_get_all_view_columns';
export * from './operation_get_all_view_rows';
export * from './operation_push_view_button';
export * from './operation_update_view_row';

export type CodaV11ViewNode =
  | CodaV11ViewDeleteViewRowNode
  | CodaV11ViewGetNode
  | CodaV11ViewGetAllNode
  | CodaV11ViewGetAllViewColumnsNode
  | CodaV11ViewGetAllViewRowsNode
  | CodaV11ViewPushViewButtonNode
  | CodaV11ViewUpdateViewRowNode
  ;