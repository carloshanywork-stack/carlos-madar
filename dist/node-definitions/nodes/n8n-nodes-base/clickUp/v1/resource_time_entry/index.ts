/**
 * ClickUp - TimeEntry Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TimeEntryCreateNode } from './operation_create';
import type { ClickUpV1TimeEntryDeleteNode } from './operation_delete';
import type { ClickUpV1TimeEntryGetNode } from './operation_get';
import type { ClickUpV1TimeEntryGetAllNode } from './operation_get_all';
import type { ClickUpV1TimeEntryStartNode } from './operation_start';
import type { ClickUpV1TimeEntryStopNode } from './operation_stop';
import type { ClickUpV1TimeEntryUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_start';
export * from './operation_stop';
export * from './operation_update';

export type ClickUpV1TimeEntryNode =
  | ClickUpV1TimeEntryCreateNode
  | ClickUpV1TimeEntryDeleteNode
  | ClickUpV1TimeEntryGetNode
  | ClickUpV1TimeEntryGetAllNode
  | ClickUpV1TimeEntryStartNode
  | ClickUpV1TimeEntryStopNode
  | ClickUpV1TimeEntryUpdateNode
  ;