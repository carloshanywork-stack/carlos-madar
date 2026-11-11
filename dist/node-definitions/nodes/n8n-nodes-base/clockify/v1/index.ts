/**
 * Clockify Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ClockifyV1ClientNode } from './resource_client';
import type { ClockifyV1ProjectNode } from './resource_project';
import type { ClockifyV1TagNode } from './resource_tag';
import type { ClockifyV1TaskNode } from './resource_task';
import type { ClockifyV1TimeEntryNode } from './resource_time_entry';
import type { ClockifyV1UserNode } from './resource_user';
import type { ClockifyV1WorkspaceNode } from './resource_workspace';

export * from './resource_client';
export * from './resource_project';
export * from './resource_tag';
export * from './resource_task';
export * from './resource_time_entry';
export * from './resource_user';
export * from './resource_workspace';

export type ClockifyV1Node =
  | ClockifyV1ClientNode
  | ClockifyV1ProjectNode
  | ClockifyV1TagNode
  | ClockifyV1TaskNode
  | ClockifyV1TimeEntryNode
  | ClockifyV1UserNode
  | ClockifyV1WorkspaceNode
  ;