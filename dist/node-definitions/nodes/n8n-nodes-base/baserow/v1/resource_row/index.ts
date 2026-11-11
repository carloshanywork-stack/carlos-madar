/**
 * Baserow - Row Resource
 * Re-exports all operation types for this resource.
 */

import type { BaserowV1RowBatchCreateNode } from './operation_batch_create';
import type { BaserowV1RowBatchDeleteNode } from './operation_batch_delete';
import type { BaserowV1RowBatchUpdateNode } from './operation_batch_update';
import type { BaserowV1RowCreateNode } from './operation_create';
import type { BaserowV1RowDeleteNode } from './operation_delete';
import type { BaserowV1RowGetNode } from './operation_get';
import type { BaserowV1RowGetAllNode } from './operation_get_all';
import type { BaserowV1RowUpdateNode } from './operation_update';

export * from './operation_batch_create';
export * from './operation_batch_delete';
export * from './operation_batch_update';
export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BaserowV1RowNode =
  | BaserowV1RowBatchCreateNode
  | BaserowV1RowBatchDeleteNode
  | BaserowV1RowBatchUpdateNode
  | BaserowV1RowCreateNode
  | BaserowV1RowDeleteNode
  | BaserowV1RowGetNode
  | BaserowV1RowGetAllNode
  | BaserowV1RowUpdateNode
  ;