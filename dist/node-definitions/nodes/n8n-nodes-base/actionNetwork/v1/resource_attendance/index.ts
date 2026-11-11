/**
 * Action Network - Attendance Resource
 * Re-exports all operation types for this resource.
 */

import type { ActionNetworkV1AttendanceCreateNode } from './operation_create';
import type { ActionNetworkV1AttendanceGetNode } from './operation_get';
import type { ActionNetworkV1AttendanceGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_get';
export * from './operation_get_all';

export type ActionNetworkV1AttendanceNode =
  | ActionNetworkV1AttendanceCreateNode
  | ActionNetworkV1AttendanceGetNode
  | ActionNetworkV1AttendanceGetAllNode
  ;