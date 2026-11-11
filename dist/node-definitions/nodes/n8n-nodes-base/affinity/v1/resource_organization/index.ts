/**
 * Affinity - Organization Resource
 * Re-exports all operation types for this resource.
 */

import type { AffinityV1OrganizationCreateNode } from './operation_create';
import type { AffinityV1OrganizationDeleteNode } from './operation_delete';
import type { AffinityV1OrganizationGetNode } from './operation_get';
import type { AffinityV1OrganizationGetAllNode } from './operation_get_all';
import type { AffinityV1OrganizationUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AffinityV1OrganizationNode =
  | AffinityV1OrganizationCreateNode
  | AffinityV1OrganizationDeleteNode
  | AffinityV1OrganizationGetNode
  | AffinityV1OrganizationGetAllNode
  | AffinityV1OrganizationUpdateNode
  ;