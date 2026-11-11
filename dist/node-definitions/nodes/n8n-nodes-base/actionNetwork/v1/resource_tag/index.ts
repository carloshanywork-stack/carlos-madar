/**
 * Action Network - Tag Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1TagCreateNode } from './operation_create';
import type { ActionNetworkV1TagGetNode } from './operation_get';
import type { ActionNetworkV1TagGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';

export type ActionNetworkV1TagNode =
  | ActionNetworkV1TagCreateNode
  | ActionNetworkV1TagGetNode
  | ActionNetworkV1TagGetAllNode
  ;