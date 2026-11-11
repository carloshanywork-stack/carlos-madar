/**
 * Clearbit - Person Resource
 * Re-exports all operation types for this resource.
 */

import type { ClearbitV1PersonEnrichNode } from './operation_enrich';

export * from './operation_enrich';

export type ClearbitV1PersonNode = ClearbitV1PersonEnrichNode;