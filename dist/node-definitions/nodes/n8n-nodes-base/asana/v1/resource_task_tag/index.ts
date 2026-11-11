/**
 * Asana - TaskTag Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1TaskTagAddNode } from './operation_add';
import type { AsanaV1TaskTagRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type AsanaV1TaskTagNode =
  | AsanaV1TaskTagAddNode
  | AsanaV1TaskTagRemoveNode
  ;