/**
 * Asana - TaskComment Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1TaskCommentAddNode } from './operation_add';
import type { AsanaV1TaskCommentRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type AsanaV1TaskCommentNode =
  | AsanaV1TaskCommentAddNode
  | AsanaV1TaskCommentRemoveNode
  ;