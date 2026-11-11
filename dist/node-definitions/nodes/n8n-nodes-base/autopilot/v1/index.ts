/**
 * Autopilot Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AutopilotV1ContactNode } from './resource_contact';
import type { AutopilotV1ContactJourneyNode } from './resource_contact_journey';
import type { AutopilotV1ContactListNode } from './resource_contact_list';
import type { AutopilotV1ListNode } from './resource_list';

export * from './resource_contact';
export * from './resource_contact_journey';
export * from './resource_contact_list';
export * from './resource_list';

export type AutopilotV1Node =
  | AutopilotV1ContactNode
  | AutopilotV1ContactJourneyNode
  | AutopilotV1ContactListNode
  | AutopilotV1ListNode
  ;