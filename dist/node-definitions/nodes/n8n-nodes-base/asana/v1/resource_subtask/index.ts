/**
 * Asana - Subtask Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1SubtaskCreateNode } from './operation_create';
import type { AsanaV1SubtaskGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_get_all';

export type AsanaV1SubtaskNode =
  | AsanaV1SubtaskCreateNode
  | AsanaV1SubtaskGetAllNode
  ;