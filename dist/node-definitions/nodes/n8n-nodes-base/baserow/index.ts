/**
 * Baserow Node Types
 *
 * Re-exports all version-specific types and provides combined union type.
 */

import type { BaserowV11Node } from './v11';
import type { BaserowV1Node } from './v1';

export * from './v11';
export * from './v1';

// Combined union type for all versions
export type BaserowNode = BaserowV11Node | BaserowV1Node;