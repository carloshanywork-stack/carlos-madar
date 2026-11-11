/**
 * Clockify - Project Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1ProjectCreateNode } from './operation_create';
import type { ClockifyV1ProjectDeleteNode } from './operation_delete';
import type { ClockifyV1ProjectGetNode } from './operation_get';
import type { ClockifyV1ProjectGetAllNode } from './operation_get_all';
import type { ClockifyV1ProjectUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ClockifyV1ProjectNode =
  | ClockifyV1ProjectCreateNode
  | ClockifyV1ProjectDeleteNode
  | ClockifyV1ProjectGetNode
  | ClockifyV1ProjectGetAllNode
  | ClockifyV1ProjectUpdateNode
  ;