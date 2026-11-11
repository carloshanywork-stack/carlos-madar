/**
 * Affinity - Person Resource
 * Re-exports all operation types for this resource.
 */

import type { AffinityV1PersonCreateNode } from './operation_create';
import type { AffinityV1PersonDeleteNode } from './operation_delete';
import type { AffinityV1PersonGetNode } from './operation_get';
import type { AffinityV1PersonGetAllNode } from './operation_get_all';
import type { AffinityV1PersonUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AffinityV1PersonNode =
  | AffinityV1PersonCreateNode
  | AffinityV1PersonDeleteNode
  | AffinityV1PersonGetNode
  | AffinityV1PersonGetAllNode
  | AffinityV1PersonUpdateNode
  ;