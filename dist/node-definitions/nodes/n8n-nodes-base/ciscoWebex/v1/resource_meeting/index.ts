/**
 * Webex by Cisco - Meeting Resource
 * Re-exports all operation types for this resource.
 */

import type { CiscoWebexV1MeetingCreateNode } from './operation_create';
import type { CiscoWebexV1MeetingDeleteNode } from './operation_delete';
import type { CiscoWebexV1MeetingGetNode } from './operation_get';
import type { CiscoWebexV1MeetingGetAllNode } from './operation_get_all';
import type { CiscoWebexV1MeetingUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type CiscoWebexV1MeetingNode =
  | CiscoWebexV1MeetingCreateNode
  | CiscoWebexV1MeetingDeleteNode
  | CiscoWebexV1MeetingGetNode
  | CiscoWebexV1MeetingGetAllNode
  | CiscoWebexV1MeetingUpdateNode
  ;