/**
 * Beeminder Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { BeeminderV1ChargeNode } from './resource_charge';
import type { BeeminderV1DatapointNode } from './resource_datapoint';
import type { BeeminderV1GoalNode } from './resource_goal';
import type { BeeminderV1UserNode } from './resource_user';

export * from './resource_charge';
export * from './resource_datapoint';
export * from './resource_goal';
export * from './resource_user';

export type BeeminderV1Node =
  | BeeminderV1ChargeNode
  | BeeminderV1DatapointNode
  | BeeminderV1GoalNode
  | BeeminderV1UserNode
  ;