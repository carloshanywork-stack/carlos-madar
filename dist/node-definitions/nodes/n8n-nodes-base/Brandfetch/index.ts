/**
 * Brandfetch Node Types
 *
 * Re-exports all version-specific types and provides combined union type.
 */

import type { BrandfetchV2Node } from './v2';
import type { BrandfetchV1Node } from './v1';

export * from './v2';
export * from './v1';

// Combined union type for all versions
export type BrandfetchNode = BrandfetchV2Node | BrandfetchV1Node;