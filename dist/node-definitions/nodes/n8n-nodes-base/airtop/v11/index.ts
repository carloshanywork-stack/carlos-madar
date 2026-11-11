/**
 * Airtop Node - Version 1.1
 * Re-exports all discriminator combinations.
 */

import type { AirtopV11AgentNode } from './resource_agent';
import type { AirtopV11ExtractionNode } from './resource_extraction';
import type { AirtopV11FileNode } from './resource_file';
import type { AirtopV11InteractionNode } from './resource_interaction';
import type { AirtopV11SessionNode } from './resource_session';
import type { AirtopV11WindowNode } from './resource_window';

export * from './resource_agent';
export * from './resource_extraction';
export * from './resource_file';
export * from './resource_interaction';
export * from './resource_session';
export * from './resource_window';

export type AirtopV11Node =
  | AirtopV11AgentNode
  | AirtopV11ExtractionNode
  | AirtopV11FileNode
  | AirtopV11InteractionNode
  | AirtopV11SessionNode
  | AirtopV11WindowNode
  ;