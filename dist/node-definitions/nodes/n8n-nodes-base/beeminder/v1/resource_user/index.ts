/**
 * Beeminder - User Resource
 * Re-exports all operation types for this resource.
 */

import type { BeeminderV1UserGetNode } from './operation_get';

export * from './operation_get';

export type BeeminderV1UserNode = BeeminderV1UserGetNode;