/**
 * Action Network - Person Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1PersonCreateNode } from './operation_create';
import type { ActionNetworkV1PersonGetNode } from './operation_get';
import type { ActionNetworkV1PersonGetAllNode } from './operation_get_all';
import type { ActionNetworkV1PersonUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActionNetworkV1PersonNode =
  | ActionNetworkV1PersonCreateNode
  | ActionNetworkV1PersonGetNode
  | ActionNetworkV1PersonGetAllNode
  | ActionNetworkV1PersonUpdateNode
  ;