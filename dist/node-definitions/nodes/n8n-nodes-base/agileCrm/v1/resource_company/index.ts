/**
 * Agile CRM - Company Resource
 * Re-exports all operation types for this resource.
 */

import type { AgileCrmV1CompanyCreateNode } from './operation_create';
import type { AgileCrmV1CompanyDeleteNode } from './operation_delete';
import type { AgileCrmV1CompanyGetNode } from './operation_get';
import type { AgileCrmV1CompanyGetAllNode } from './operation_get_all';
import type { AgileCrmV1CompanyUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AgileCrmV1CompanyNode =
  | AgileCrmV1CompanyCreateNode
  | AgileCrmV1CompanyDeleteNode
  | AgileCrmV1CompanyGetNode
  | AgileCrmV1CompanyGetAllNode
  | AgileCrmV1CompanyUpdateNode
  ;