/**
 * Clockify - TimeEntry Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1TimeEntryCreateNode } from './operation_create';
import type { ClockifyV1TimeEntryDeleteNode } from './operation_delete';
import type { ClockifyV1TimeEntryGetNode } from './operation_get';
import type { ClockifyV1TimeEntryUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_update';

export type ClockifyV1TimeEntryNode =
  | ClockifyV1TimeEntryCreateNode
  | ClockifyV1TimeEntryDeleteNode
  | ClockifyV1TimeEntryGetNode
  | ClockifyV1TimeEntryUpdateNode
  ;