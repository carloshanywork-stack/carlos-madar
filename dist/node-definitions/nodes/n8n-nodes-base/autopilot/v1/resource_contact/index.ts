/**
 * Autopilot - Contact Resource
 * Re-exports all operation types for this resource.
 */

import type { AutopilotV1ContactDeleteNode } from './operation_delete';
import type { AutopilotV1ContactGetNode } from './operation_get';
import type { AutopilotV1ContactGetAllNode } from './operation_get_all';
import type { AutopilotV1ContactUpsertNode } from './operation_upsert';

export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_upsert';

export type AutopilotV1ContactNode =
  | AutopilotV1ContactDeleteNode
  | AutopilotV1ContactGetNode
  | AutopilotV1ContactGetAllNode
  | AutopilotV1ContactUpsertNode
  ;