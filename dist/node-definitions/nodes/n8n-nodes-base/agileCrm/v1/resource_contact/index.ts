/**
 * Agile CRM - Contact Resource
 * Re-exports all operation types for this resource.
 */

import type { AgileCrmV1ContactCreateNode } from './operation_create';
import type { AgileCrmV1ContactDeleteNode } from './operation_delete';
import type { AgileCrmV1ContactGetNode } from './operation_get';
import type { AgileCrmV1ContactGetAllNode } from './operation_get_all';
import type { AgileCrmV1ContactUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AgileCrmV1ContactNode =
  | AgileCrmV1ContactCreateNode
  | AgileCrmV1ContactDeleteNode
  | AgileCrmV1ContactGetNode
  | AgileCrmV1ContactGetAllNode
  | AgileCrmV1ContactUpdateNode
  ;