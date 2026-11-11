/**
 * ClickUp - Goal Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1GoalCreateNode } from './operation_create';
import type { ClickUpV1GoalDeleteNode } from './operation_delete';
import type { ClickUpV1GoalGetNode } from './operation_get';
import type { ClickUpV1GoalGetAllNode } from './operation_get_all';
import type { ClickUpV1GoalUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ClickUpV1GoalNode =
  | ClickUpV1GoalCreateNode
  | ClickUpV1GoalDeleteNode
  | ClickUpV1GoalGetNode
  | ClickUpV1GoalGetAllNode
  | ClickUpV1GoalUpdateNode
  ;