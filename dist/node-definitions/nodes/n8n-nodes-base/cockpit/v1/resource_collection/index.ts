/**
 * Cockpit - Collection Resource
 * Re-exports all operation types for this resource.
 */

import type { CockpitV1CollectionCreateNode } from './operation_create';
import type { CockpitV1CollectionGetAllNode } from './operation_get_all';
import type { CockpitV1CollectionUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_get_all';
export * from './operation_update';

export type CockpitV1CollectionNode =
  | CockpitV1CollectionCreateNode
  | CockpitV1CollectionGetAllNode
  | CockpitV1CollectionUpdateNode
  ;