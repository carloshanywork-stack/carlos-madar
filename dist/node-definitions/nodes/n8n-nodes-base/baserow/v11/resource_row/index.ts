/**
 * Baserow - Row Resource
 * Re-exports all operation types for this resource.
 */

import type { BaserowV11RowBatchCreateNode } from './operation_batch_create';
import type { BaserowV11RowBatchDeleteNode } from './operation_batch_delete';
import type { BaserowV11RowBatchUpdateNode } from './operation_batch_update';
import type { BaserowV11RowCreateNode } from './operation_create';
import type { BaserowV11RowDeleteNode } from './operation_delete';
import type { BaserowV11RowGetNode } from './operation_get';
import type { BaserowV11RowGetAllNode } from './operation_get_all';
import type { BaserowV11RowUpdateNode } from './operation_update';

export * from './operation_batch_create';
export * from './operation_batch_delete';
export * from './operation_batch_update';
export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BaserowV11RowNode =
  | BaserowV11RowBatchCreateNode
  | BaserowV11RowBatchDeleteNode
  | BaserowV11RowBatchUpdateNode
  | BaserowV11RowCreateNode
  | BaserowV11RowDeleteNode
  | BaserowV11RowGetNode
  | BaserowV11RowGetAllNode
  | BaserowV11RowUpdateNode
  ;