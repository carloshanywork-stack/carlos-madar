/**
 * ClickUp - TaskList Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TaskListAddNode } from './operation_add';
import type { ClickUpV1TaskListRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type ClickUpV1TaskListNode =
  | ClickUpV1TaskListAddNode
  | ClickUpV1TaskListRemoveNode
  ;