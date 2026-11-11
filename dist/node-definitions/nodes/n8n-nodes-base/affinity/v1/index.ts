/**
 * Affinity Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AffinityV1ListNode } from './resource_list';
import type { AffinityV1ListEntryNode } from './resource_list_entry';
import type { AffinityV1OrganizationNode } from './resource_organization';
import type { AffinityV1PersonNode } from './resource_person';

export * from './resource_list';
export * from './resource_list_entry';
export * from './resource_organization';
export * from './resource_person';

export type AffinityV1Node =
  | AffinityV1ListNode
  | AffinityV1ListEntryNode
  | AffinityV1OrganizationNode
  | AffinityV1PersonNode
  ;