/**
 * Clearbit - Company Resource
 * Re-exports all operation types for this resource.
 */

import type { ClearbitV1CompanyAutocompleteNode } from './operation_autocomplete';
import type { ClearbitV1CompanyEnrichNode } from './operation_enrich';

export * from './operation_autocomplete';
export * from './operation_enrich';

export type ClearbitV1CompanyNode =
  | ClearbitV1CompanyAutocompleteNode
  | ClearbitV1CompanyEnrichNode
  ;