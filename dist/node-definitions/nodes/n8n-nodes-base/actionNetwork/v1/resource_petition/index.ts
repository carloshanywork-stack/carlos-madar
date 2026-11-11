/**
 * Action Network - Petition Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1PetitionCreateNode } from './operation_create';
import type { ActionNetworkV1PetitionGetNode } from './operation_get';
import type { ActionNetworkV1PetitionGetAllNode } from './operation_get_all';
import type { ActionNetworkV1PetitionUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActionNetworkV1PetitionNode =
  | ActionNetworkV1PetitionCreateNode
  | ActionNetworkV1PetitionGetNode
  | ActionNetworkV1PetitionGetAllNode
  | ActionNetworkV1PetitionUpdateNode
  ;