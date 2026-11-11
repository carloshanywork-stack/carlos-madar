/**
 * Affinity - List Resource
 * Re-exports all operation types for this resource.
 */

import type { AffinityV1ListGetNode } from './operation_get';
import type { AffinityV1ListGetAllNode } from './operation_get_all';

export * from './operation_get';
export * from './operation_get_all';

export type AffinityV1ListNode =
  | AffinityV1ListGetNode
  | AffinityV1ListGetAllNode
  ;