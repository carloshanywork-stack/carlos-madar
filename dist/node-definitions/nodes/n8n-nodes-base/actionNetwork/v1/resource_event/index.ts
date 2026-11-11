/**
 * Action Network - Event Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1EventCreateNode } from './operation_create';
import type { ActionNetworkV1EventGetNode } from './operation_get';
import type { ActionNetworkV1EventGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';

export type ActionNetworkV1EventNode =
  | ActionNetworkV1EventCreateNode
  | ActionNetworkV1EventGetNode
  | ActionNetworkV1EventGetAllNode
  ;