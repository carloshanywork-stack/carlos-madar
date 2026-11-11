/**
 * Coda Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CodaV1ControlNode } from './resource_control';
import type { CodaV1FormulaNode } from './resource_formula';
import type { CodaV1TableNode } from './resource_table';
import type { CodaV1ViewNode } from './resource_view';

export * from './resource_control';
export * from './resource_formula';
export * from './resource_table';
export * from './resource_view';

export type CodaV1Node =
  | CodaV1ControlNode
  | CodaV1FormulaNode
  | CodaV1TableNode
  | CodaV1ViewNode
  ;