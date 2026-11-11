/**
 * Clockify - Task Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1TaskCreateNode } from './operation_create';
import type { ClockifyV1TaskDeleteNode } from './operation_delete';
import type { ClockifyV1TaskGetNode } from './operation_get';
import type { ClockifyV1TaskGetAllNode } from './operation_get_all';
import type { ClockifyV1TaskUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ClockifyV1TaskNode =
  | ClockifyV1TaskCreateNode
  | ClockifyV1TaskDeleteNode
  | ClockifyV1TaskGetNode
  | ClockifyV1TaskGetAllNode
  | ClockifyV1TaskUpdateNode
  ;