/**
 * Clockify - Client Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1ClientCreateNode } from './operation_create';
import type { ClockifyV1ClientDeleteNode } from './operation_delete';
import type { ClockifyV1ClientGetNode } from './operation_get';
import type { ClockifyV1ClientGetAllNode } from './operation_get_all';
import type { ClockifyV1ClientUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ClockifyV1ClientNode =
  | ClockifyV1ClientCreateNode
  | ClockifyV1ClientDeleteNode
  | ClockifyV1ClientGetNode
  | ClockifyV1ClientGetAllNode
  | ClockifyV1ClientUpdateNode
  ;