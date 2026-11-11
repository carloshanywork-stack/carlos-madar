/**
 * Box - Folder Resource
 * Re-exports all operation types for this resource.
 */

import type { BoxV1FolderCreateNode } from './operation_create';
import type { BoxV1FolderDeleteNode } from './operation_delete';
import type { BoxV1FolderGetNode } from './operation_get';
import type { BoxV1FolderSearchNode } from './operation_search';
import type { BoxV1FolderShareNode } from './operation_share';
import type { BoxV1FolderUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_search';
export * from './operation_share';
export * from './operation_update';

export type BoxV1FolderNode =
  | BoxV1FolderCreateNode
  | BoxV1FolderDeleteNode
  | BoxV1FolderGetNode
  | BoxV1FolderSearchNode
  | BoxV1FolderShareNode
  | BoxV1FolderUpdateNode
  ;