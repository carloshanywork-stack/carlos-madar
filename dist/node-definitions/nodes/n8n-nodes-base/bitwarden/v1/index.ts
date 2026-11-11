/**
 * Bitwarden Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { BitwardenV1CollectionNode } from './resource_collection';
import type { BitwardenV1EventNode } from './resource_event';
import type { BitwardenV1GroupNode } from './resource_group';
import type { BitwardenV1MemberNode } from './resource_member';

export * from './resource_collection';
export * from './resource_event';
export * from './resource_group';
export * from './resource_member';

export type BitwardenV1Node =
  | BitwardenV1CollectionNode
  | BitwardenV1EventNode
  | BitwardenV1GroupNode
  | BitwardenV1MemberNode
  ;