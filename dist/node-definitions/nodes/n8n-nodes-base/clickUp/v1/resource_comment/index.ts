/**
 * ClickUp - Comment Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1CommentCreateNode } from './operation_create';
import type { ClickUpV1CommentDeleteNode } from './operation_delete';
import type { ClickUpV1CommentGetAllNode } from './operation_get_all';
import type { ClickUpV1CommentUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';
export * from './operation_update';

export type ClickUpV1CommentNode =
  | ClickUpV1CommentCreateNode
  | ClickUpV1CommentDeleteNode
  | ClickUpV1CommentGetAllNode
  | ClickUpV1CommentUpdateNode
  ;