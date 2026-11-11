/**
 * Beeminder - Datapoint Resource
 * Re-exports all operation types for this resource.
 */

import type { BeeminderV1DatapointCreateNode } from './operation_create';
import type { BeeminderV1DatapointCreateAllNode } from './operation_create_all';
import type { BeeminderV1DatapointDeleteNode } from './operation_delete';
import type { BeeminderV1DatapointGetNode } from './operation_get';
import type { BeeminderV1DatapointGetAllNode } from './operation_get_all';
import type { BeeminderV1DatapointUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_create_all';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BeeminderV1DatapointNode =
  | BeeminderV1DatapointCreateNode
  | BeeminderV1DatapointCreateAllNode
  | BeeminderV1DatapointDeleteNode
  | BeeminderV1DatapointGetNode
  | BeeminderV1DatapointGetAllNode
  | BeeminderV1DatapointUpdateNode
  ;