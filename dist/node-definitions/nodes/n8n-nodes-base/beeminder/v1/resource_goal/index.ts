/**
 * Beeminder - Goal Resource
 * Re-exports all operation types for this resource.
 */

import type { BeeminderV1GoalCancelStepDownNode } from './operation_cancel_step_down';
import type { BeeminderV1GoalCreateNode } from './operation_create';
import type { BeeminderV1GoalGetNode } from './operation_get';
import type { BeeminderV1GoalGetAllNode } from './operation_get_all';
import type { BeeminderV1GoalGetArchivedNode } from './operation_get_archived';
import type { BeeminderV1GoalRefreshNode } from './operation_refresh';
import type { BeeminderV1GoalShortCircuitNode } from './operation_short_circuit';
import type { BeeminderV1GoalStepDownNode } from './operation_step_down';
import type { BeeminderV1GoalUncleNode } from './operation_uncle';
import type { BeeminderV1GoalUpdateNode } from './operation_update';

export * from './operation_cancel_step_down';
export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_get_archived';
export * from './operation_refresh';
export * from './operation_short_circuit';
export * from './operation_step_down';
export * from './operation_uncle';
export * from './operation_update';

export type BeeminderV1GoalNode =
  | BeeminderV1GoalCancelStepDownNode
  | BeeminderV1GoalCreateNode
  | BeeminderV1GoalGetNode
  | BeeminderV1GoalGetAllNode
  | BeeminderV1GoalGetArchivedNode
  | BeeminderV1GoalRefreshNode
  | BeeminderV1GoalShortCircuitNode
  | BeeminderV1GoalStepDownNode
  | BeeminderV1GoalUncleNode
  | BeeminderV1GoalUpdateNode
  ;