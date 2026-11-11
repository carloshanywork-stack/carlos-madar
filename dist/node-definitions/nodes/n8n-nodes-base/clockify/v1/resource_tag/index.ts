/**
 * Clockify - Tag Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1TagCreateNode } from './operation_create';
import type { ClockifyV1TagDeleteNode } from './operation_delete';
import type { ClockifyV1TagGetAllNode } from './operation_get_all';
import type { ClockifyV1TagUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';
export * from './operation_update';

export type ClockifyV1TagNode =
  | ClockifyV1TagCreateNode
  | ClockifyV1TagDeleteNode
  | ClockifyV1TagGetAllNode
  | ClockifyV1TagUpdateNode
  ;