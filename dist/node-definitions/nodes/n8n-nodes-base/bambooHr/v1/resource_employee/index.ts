/**
 * BambooHR - Employee Resource
 * Re-exports all operation types for this resource.
 */

import type { BambooHrV1EmployeeCreateNode } from './operation_create';
import type { BambooHrV1EmployeeGetNode } from './operation_get';
import type { BambooHrV1EmployeeGetAllNode } from './operation_get_all';
import type { BambooHrV1EmployeeUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BambooHrV1EmployeeNode =
  | BambooHrV1EmployeeCreateNode
  | BambooHrV1EmployeeGetNode
  | BambooHrV1EmployeeGetAllNode
  | BambooHrV1EmployeeUpdateNode
  ;