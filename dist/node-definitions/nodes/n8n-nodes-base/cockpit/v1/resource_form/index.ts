/**
 * Cockpit - Form Resource
 * Re-exports all operation types for this resource.
 */

import type { CockpitV1FormSubmitNode } from './operation_submit';

export * from './operation_submit';

export type CockpitV1FormNode = CockpitV1FormSubmitNode;