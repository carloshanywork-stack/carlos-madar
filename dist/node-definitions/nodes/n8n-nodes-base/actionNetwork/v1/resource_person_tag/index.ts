/**
 * Action Network - PersonTag Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1PersonTagAddNode } from './operation_add';
import type { ActionNetworkV1PersonTagRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type ActionNetworkV1PersonTagNode =
  | ActionNetworkV1PersonTagAddNode
  | ActionNetworkV1PersonTagRemoveNode
  ;