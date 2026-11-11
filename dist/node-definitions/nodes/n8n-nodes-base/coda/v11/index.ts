/**
 * Coda Node - Version 1.1
 * Re-exports all discriminator combinations.
 */

import type { CodaV11ControlNode } from './resource_control';
import type { CodaV11FormulaNode } from './resource_formula';
import type { CodaV11TableNode } from './resource_table';
import type { CodaV11ViewNode } from './resource_view';

export * from './resource_control';
export * from './resource_formula';
export * from './resource_table';
export * from './resource_view';

export type CodaV11Node =
  | CodaV11ControlNode
  | CodaV11FormulaNode
  | CodaV11TableNode
  | CodaV11ViewNode
  ;