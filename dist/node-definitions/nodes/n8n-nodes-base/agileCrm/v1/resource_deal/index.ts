/**
 * Agile CRM - Deal Resource
 * Re-exports all operation types for this resource.
 */

import type { AgileCrmV1DealCreateNode } from './operation_create';
import type { AgileCrmV1DealDeleteNode } from './operation_delete';
import type { AgileCrmV1DealGetNode } from './operation_get';
import type { AgileCrmV1DealGetAllNode } from './operation_get_all';
import type { AgileCrmV1DealUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AgileCrmV1DealNode =
  | AgileCrmV1DealCreateNode
  | AgileCrmV1DealDeleteNode
  | AgileCrmV1DealGetNode
  | AgileCrmV1DealGetAllNode
  | AgileCrmV1DealUpdateNode
  ;