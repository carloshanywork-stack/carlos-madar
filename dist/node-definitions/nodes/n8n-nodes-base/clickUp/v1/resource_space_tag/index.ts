/**
 * ClickUp - SpaceTag Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1SpaceTagCreateNode } from './operation_create';
import type { ClickUpV1SpaceTagDeleteNode } from './operation_delete';
import type { ClickUpV1SpaceTagGetAllNode } from './operation_get_all';
import type { ClickUpV1SpaceTagUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';
export * from './operation_update';

export type ClickUpV1SpaceTagNode =
  | ClickUpV1SpaceTagCreateNode
  | ClickUpV1SpaceTagDeleteNode
  | ClickUpV1SpaceTagGetAllNode
  | ClickUpV1SpaceTagUpdateNode
  ;