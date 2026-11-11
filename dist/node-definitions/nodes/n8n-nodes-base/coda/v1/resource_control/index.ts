/**
 * Coda - Control Resource
 * Re-exports all operation types for this resource.
 */

import type { CodaV1ControlGetNode } from './operation_get';
import type { CodaV1ControlGetAllNode } from './operation_get_all';

export * from './operation_get';
export * from './operation_get_all';

export type CodaV1ControlNode =
  | CodaV1ControlGetNode
  | CodaV1ControlGetAllNode
  ;