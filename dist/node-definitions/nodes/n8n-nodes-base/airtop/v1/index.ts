/**
 * Airtop Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AirtopV1AgentNode } from './resource_agent';
import type { AirtopV1ExtractionNode } from './resource_extraction';
import type { AirtopV1FileNode } from './resource_file';
import type { AirtopV1InteractionNode } from './resource_interaction';
import type { AirtopV1SessionNode } from './resource_session';
import type { AirtopV1WindowNode } from './resource_window';

export * from './resource_agent';
export * from './resource_extraction';
export * from './resource_file';
export * from './resource_interaction';
export * from './resource_session';
export * from './resource_window';

export type AirtopV1Node =
  | AirtopV1AgentNode
  | AirtopV1ExtractionNode
  | AirtopV1FileNode
  | AirtopV1InteractionNode
  | AirtopV1SessionNode
  | AirtopV1WindowNode
  ;