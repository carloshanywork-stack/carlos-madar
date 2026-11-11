/**
 * ClickUp - TimeEntryTag Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1TimeEntryTagAddNode } from './operation_add';
import type { ClickUpV1TimeEntryTagGetAllNode } from './operation_get_all';
import type { ClickUpV1TimeEntryTagRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_get_all';
export * from './operation_remove';

export type ClickUpV1TimeEntryTagNode =
  | ClickUpV1TimeEntryTagAddNode
  | ClickUpV1TimeEntryTagGetAllNode
  | ClickUpV1TimeEntryTagRemoveNode
  ;