/**
 * ClickUp - Task Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TaskCreateNode } from './operation_create';
import type { ClickUpV1TaskDeleteNode } from './operation_delete';
import type { ClickUpV1TaskGetNode } from './operation_get';
import type { ClickUpV1TaskGetAllNode } from './operation_get_all';
import type { ClickUpV1TaskMemberNode } from './operation_member';
import type { ClickUpV1TaskSetCustomFieldNode } from './operation_set_custom_field';
import type { ClickUpV1TaskUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_member';
export * from './operation_set_custom_field';
export * from './operation_update';

export type ClickUpV1TaskNode =
  | ClickUpV1TaskCreateNode
  | ClickUpV1TaskDeleteNode
  | ClickUpV1TaskGetNode
  | ClickUpV1TaskGetAllNode
  | ClickUpV1TaskMemberNode
  | ClickUpV1TaskSetCustomFieldNode
  | ClickUpV1TaskUpdateNode
  ;