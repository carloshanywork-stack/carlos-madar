/**
 * ClickUp - Folder Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1FolderCreateNode } from './operation_create';
import type { ClickUpV1FolderDeleteNode } from './operation_delete';
import type { ClickUpV1FolderGetNode } from './operation_get';
import type { ClickUpV1FolderGetAllNode } from './operation_get_all';
import type { ClickUpV1FolderUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ClickUpV1FolderNode =
  | ClickUpV1FolderCreateNode
  | ClickUpV1FolderDeleteNode
  | ClickUpV1FolderGetNode
  | ClickUpV1FolderGetAllNode
  | ClickUpV1FolderUpdateNode
  ;