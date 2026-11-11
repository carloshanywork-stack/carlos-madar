/**
 * Asana - TaskProject Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1TaskProjectAddNode } from './operation_add';
import type { AsanaV1TaskProjectRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type AsanaV1TaskProjectNode =
  | AsanaV1TaskProjectAddNode
  | AsanaV1TaskProjectRemoveNode
  ;