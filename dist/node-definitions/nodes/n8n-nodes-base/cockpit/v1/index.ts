/**
 * Cockpit Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CockpitV1CollectionNode } from './resource_collection';
import type { CockpitV1FormNode } from './resource_form';
import type { CockpitV1SingletonNode } from './resource_singleton';

export * from './resource_collection';
export * from './resource_form';
export * from './resource_singleton';

export type CockpitV1Node =
  | CockpitV1CollectionNode
  | CockpitV1FormNode
  | CockpitV1SingletonNode
  ;