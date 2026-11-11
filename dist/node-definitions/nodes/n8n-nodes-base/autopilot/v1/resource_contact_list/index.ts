/**
 * Autopilot - ContactList Resource
 * Re-exports all operation types for this resource.
 */

import type { AutopilotV1ContactListAddNode } from './operation_add';
import type { AutopilotV1ContactListExistNode } from './operation_exist';
import type { AutopilotV1ContactListGetAllNode } from './operation_get_all';
import type { AutopilotV1ContactListRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_exist';
export * from './operation_get_all';
export * from './operation_remove';

export type AutopilotV1ContactListNode =
  | AutopilotV1ContactListAddNode
  | AutopilotV1ContactListExistNode
  | AutopilotV1ContactListGetAllNode
  | AutopilotV1ContactListRemoveNode
  ;