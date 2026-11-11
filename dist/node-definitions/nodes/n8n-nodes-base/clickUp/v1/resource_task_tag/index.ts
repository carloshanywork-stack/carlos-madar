/**
 * ClickUp - TaskTag Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TaskTagAddNode } from './operation_add';
import type { ClickUpV1TaskTagRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type ClickUpV1TaskTagNode =
  | ClickUpV1TaskTagAddNode
  | ClickUpV1TaskTagRemoveNode
  ;