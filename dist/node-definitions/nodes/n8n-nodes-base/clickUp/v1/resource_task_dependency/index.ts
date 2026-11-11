/**
 * ClickUp - TaskDependency Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TaskDependencyCreateNode } from './operation_create';
import type { ClickUpV1TaskDependencyDeleteNode } from './operation_delete';

export * from './operation_create';
export * from './operation_delete';

export type ClickUpV1TaskDependencyNode =
  | ClickUpV1TaskDependencyCreateNode
  | ClickUpV1TaskDependencyDeleteNode
  ;