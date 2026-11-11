/**
 * ClickUp - GoalKeyResult Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1GoalKeyResultCreateNode } from './operation_create';
import type { ClickUpV1GoalKeyResultDeleteNode } from './operation_delete';
import type { ClickUpV1GoalKeyResultUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_update';

export type ClickUpV1GoalKeyResultNode =
  | ClickUpV1GoalKeyResultCreateNode
  | ClickUpV1GoalKeyResultDeleteNode
  | ClickUpV1GoalKeyResultUpdateNode
  ;