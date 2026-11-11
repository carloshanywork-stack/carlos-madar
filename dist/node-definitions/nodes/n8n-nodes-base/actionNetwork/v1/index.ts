/**
 * Action Network Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ActionNetworkV1AttendanceNode } from './resource_attendance';
import type { ActionNetworkV1EventNode } from './resource_event';
import type { ActionNetworkV1PersonNode } from './resource_person';
import type { ActionNetworkV1PersonTagNode } from './resource_person_tag';
import type { ActionNetworkV1PetitionNode } from './resource_petition';
import type { ActionNetworkV1SignatureNode } from './resource_signature';
import type { ActionNetworkV1TagNode } from './resource_tag';

export * from './resource_attendance';
export * from './resource_event';
export * from './resource_person';
export * from './resource_person_tag';
export * from './resource_petition';
export * from './resource_signature';
export * from './resource_tag';

export type ActionNetworkV1Node =
  | ActionNetworkV1AttendanceNode
  | ActionNetworkV1EventNode
  | ActionNetworkV1PersonNode
  | ActionNetworkV1PersonTagNode
  | ActionNetworkV1PetitionNode
  | ActionNetworkV1SignatureNode
  | ActionNetworkV1TagNode
  ;