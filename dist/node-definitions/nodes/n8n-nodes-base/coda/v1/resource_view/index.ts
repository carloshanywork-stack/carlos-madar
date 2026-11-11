/**
 * Coda - View Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV1ViewDeleteViewRowNode } from './operation_delete_view_row';
import type { CodaV1ViewGetNode } from './operation_get';
import type { CodaV1ViewGetAllNode } from './operation_get_all';
import type { CodaV1ViewGetAllViewColumnsNode } from './operation_get_all_view_columns';
import type { CodaV1ViewGetAllViewRowsNode } from './operation_get_all_view_rows';
import type { CodaV1ViewPushViewButtonNode } from './operation_push_view_button';
import type { CodaV1ViewUpdateViewRowNode } from './operation_update_view_row';

export * from './operation_delete_view_row';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_get_all_view_columns';
export * from './operation_get_all_view_rows';
export * from './operation_push_view_button';
export * from './operation_update_view_row';

export type CodaV1ViewNode =
  | CodaV1ViewDeleteViewRowNode
  | CodaV1ViewGetNode
  | CodaV1ViewGetAllNode
  | CodaV1ViewGetAllViewColumnsNode
  | CodaV1ViewGetAllViewRowsNode
  | CodaV1ViewPushViewButtonNode
  | CodaV1ViewUpdateViewRowNode
  ;