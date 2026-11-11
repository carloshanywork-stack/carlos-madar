/**
 * Affinity - ListEntry Resource
 * Re-exports all operation types for this resource.
 */

import type { AffinityV1ListEntryCreateNode } from './operation_create';
import type { AffinityV1ListEntryDeleteNode } from './operation_delete';
import type { AffinityV1ListEntryGetNode } from './operation_get';
import type { AffinityV1ListEntryGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';

export type AffinityV1ListEntryNode =
  | AffinityV1ListEntryCreateNode
  | AffinityV1ListEntryDeleteNode
  | AffinityV1ListEntryGetNode
  | AffinityV1ListEntryGetAllNode
  ;