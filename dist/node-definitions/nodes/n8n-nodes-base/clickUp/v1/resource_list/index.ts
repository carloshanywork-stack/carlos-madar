/**
 * ClickUp - List Resource
 * Re-exports all operation types for this resource.
 */

import type { ClickUpV1ListCreateNode } from './operation_create';
import type { ClickUpV1ListCustomFieldsNode } from './operation_custom_fields';
import type { ClickUpV1ListDeleteNode } from './operation_delete';
import type { ClickUpV1ListGetNode } from './operation_get';
import type { ClickUpV1ListGetAllNode } from './operation_get_all';
import type { ClickUpV1ListMemberNode } from './operation_member';
import type { ClickUpV1ListUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_custom_fields';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_member';
export * from './operation_update';

export type ClickUpV1ListNode =
  | ClickUpV1ListCreateNode
  | ClickUpV1ListCustomFieldsNode
  | ClickUpV1ListDeleteNode
  | ClickUpV1ListGetNode
  | ClickUpV1ListGetAllNode
  | ClickUpV1ListMemberNode
  | ClickUpV1ListUpdateNode
  ;