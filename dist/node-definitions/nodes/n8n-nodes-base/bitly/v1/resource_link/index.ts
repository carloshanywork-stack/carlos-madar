/**
 * Bitly - Link Resource
 * Re-exports all operation types for this resource.
 */

import type { BitlyV1LinkCreateNode } from './operation_create';
import type { BitlyV1LinkGetNode } from './operation_get';
import type { BitlyV1LinkUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_get';
export * from './operation_update';

export type BitlyV1LinkNode =
  | BitlyV1LinkCreateNode
  | BitlyV1LinkGetNode
  | BitlyV1LinkUpdateNode
  ;