/**
 * Cal.com Trigger Node Types
 *
 * Re-exports all version-specific types and provides combined union type.
 */

import type { CalTriggerV3Node } from './v3';
import type { CalTriggerV2Node } from './v2';
import type { CalTriggerV1Node } from './v1';

export * from './v3';
export * from './v2';
export * from './v1';

// Combined union type for all versions
export type CalTriggerNode = CalTriggerV3Node | CalTriggerV2Node | CalTriggerV1Node;