/**
 * Calendly Trigger Node Types
 *
 * Re-exports all version-specific types and provides combined union type.
 */

import type { CalendlyTriggerV2Node } from './v2';
import type { CalendlyTriggerV1Node } from './v1';

export * from './v2';
export * from './v1';

// Combined union type for all versions
export type CalendlyTriggerNode = CalendlyTriggerV2Node | CalendlyTriggerV1Node;