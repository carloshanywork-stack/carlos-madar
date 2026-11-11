/**
 * Cockpit - Singleton Resource
 * Re-exports all operation types for this resource.
 */

import type { CockpitV1SingletonGetNode } from './operation_get';

export * from './operation_get';

export type CockpitV1SingletonNode = CockpitV1SingletonGetNode;