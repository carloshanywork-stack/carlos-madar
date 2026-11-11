/**
 * Asana - Task Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1TaskCreateNode } from './operation_create';
import type { AsanaV1TaskDeleteNode } from './operation_delete';
import type { AsanaV1TaskGetNode } from './operation_get';
import type { AsanaV1TaskGetAllNode } from './operation_get_all';
import type { AsanaV1TaskMoveNode } from './operation_move';
import type { AsanaV1TaskSearchNode } from './operation_search';
import type { AsanaV1TaskUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_move';
export * from './operation_search';
export * from './operation_update';

export type AsanaV1TaskNode =
  | AsanaV1TaskCreateNode
  | AsanaV1TaskDeleteNode
  | AsanaV1TaskGetNode
  | AsanaV1TaskGetAllNode
  | AsanaV1TaskMoveNode
  | AsanaV1TaskSearchNode
  | AsanaV1TaskUpdateNode
  ;