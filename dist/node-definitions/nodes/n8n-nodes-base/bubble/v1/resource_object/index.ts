/**
 * Bubble - Object Resource
 * Re-exports all operation types for this resource.
 */

import type { BubbleV1ObjectCreateNode } from './operation_create';
import type { BubbleV1ObjectDeleteNode } from './operation_delete';
import type { BubbleV1ObjectGetNode } from './operation_get';
import type { BubbleV1ObjectGetAllNode } from './operation_get_all';
import type { BubbleV1ObjectUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BubbleV1ObjectNode =
  | BubbleV1ObjectCreateNode
  | BubbleV1ObjectDeleteNode
  | BubbleV1ObjectGetNode
  | BubbleV1ObjectGetAllNode
  | BubbleV1ObjectUpdateNode
  ;