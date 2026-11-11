/**
 * Coda - Control Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV11ControlGetNode } from './operation_get';
import type { CodaV11ControlGetAllNode } from './operation_get_all';

export * from './operation_get';
export * from './operation_get_all';

export type CodaV11ControlNode =
  | CodaV11ControlGetNode
  | CodaV11ControlGetAllNode
  ;