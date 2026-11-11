/**
 * ClickUp Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ClickUpV1ChecklistNode } from './resource_checklist';
import type { ClickUpV1ChecklistItemNode } from './resource_checklist_item';
import type { ClickUpV1CommentNode } from './resource_comment';
import type { ClickUpV1FolderNode } from './resource_folder';
import type { ClickUpV1GoalNode } from './resource_goal';
import type { ClickUpV1GoalKeyResultNode } from './resource_goal_key_result';
import type { ClickUpV1ListNode } from './resource_list';
import type { ClickUpV1SpaceTagNode } from './resource_space_tag';
import type { ClickUpV1TaskNode } from './resource_task';
import type { ClickUpV1TaskDependencyNode } from './resource_task_dependency';
import type { ClickUpV1TaskListNode } from './resource_task_list';
import type { ClickUpV1TaskTagNode } from './resource_task_tag';
import type { ClickUpV1TimeEntryNode } from './resource_time_entry';
import type { ClickUpV1TimeEntryTagNode } from './resource_time_entry_tag';

export * from './resource_checklist';
export * from './resource_checklist_item';
export * from './resource_comment';
export * from './resource_folder';
export * from './resource_goal';
export * from './resource_goal_key_result';
export * from './resource_list';
export * from './resource_space_tag';
export * from './resource_task';
export * from './resource_task_dependency';
export * from './resource_task_list';
export * from './resource_task_tag';
export * from './resource_time_entry';
export * from './resource_time_entry_tag';

export type ClickUpV1Node =
  | ClickUpV1ChecklistNode
  | ClickUpV1ChecklistItemNode
  | ClickUpV1CommentNode
  | ClickUpV1FolderNode
  | ClickUpV1GoalNode
  | ClickUpV1GoalKeyResultNode
  | ClickUpV1ListNode
  | ClickUpV1SpaceTagNode
  | ClickUpV1TaskNode
  | ClickUpV1TaskDependencyNode
  | ClickUpV1TaskListNode
  | ClickUpV1TaskTagNode
  | ClickUpV1TimeEntryNode
  | ClickUpV1TimeEntryTagNode
  ;