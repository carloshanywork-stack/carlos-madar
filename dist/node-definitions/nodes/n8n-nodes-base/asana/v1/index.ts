/**
 * Asana Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AsanaV1ProjectNode } from './resource_project';
import type { AsanaV1SubtaskNode } from './resource_subtask';
import type { AsanaV1TaskNode } from './resource_task';
import type { AsanaV1TaskCommentNode } from './resource_task_comment';
import type { AsanaV1TaskProjectNode } from './resource_task_project';
import type { AsanaV1TaskTagNode } from './resource_task_tag';
import type { AsanaV1UserNode } from './resource_user';

export * from './resource_project';
export * from './resource_subtask';
export * from './resource_task';
export * from './resource_task_comment';
export * from './resource_task_project';
export * from './resource_task_tag';
export * from './resource_user';

export type AsanaV1Node =
  | AsanaV1ProjectNode
  | AsanaV1SubtaskNode
  | AsanaV1TaskNode
  | AsanaV1TaskCommentNode
  | AsanaV1TaskProjectNode
  | AsanaV1TaskTagNode
  | AsanaV1UserNode
  ;