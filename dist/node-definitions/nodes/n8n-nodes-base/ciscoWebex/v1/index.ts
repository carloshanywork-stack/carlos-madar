/**
 * Webex by Cisco Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CiscoWebexV1MeetingNode } from './resource_meeting';
import type { CiscoWebexV1MessageNode } from './resource_message';

export * from './resource_meeting';
export * from './resource_message';

export type CiscoWebexV1Node =
  | CiscoWebexV1MeetingNode
  | CiscoWebexV1MessageNode
  ;