/**
 * Bitwarden - Group Resource
 * Re-exports all operation types for this resource.
 */

import type { BitwardenV1GroupCreateNode } from './operation_create';
import type { BitwardenV1GroupDeleteNode } from './operation_delete';
import type { BitwardenV1GroupGetNode } from './operation_get';
import type { BitwardenV1GroupGetAllNode } from './operation_get_all';
import type { BitwardenV1GroupGetMembersNode } from './operation_get_members';
import type { BitwardenV1GroupUpdateNode } from './operation_update';
import type { BitwardenV1GroupUpdateMembersNode } from './operation_update_members';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_get_members';
export * from './operation_update';
export * from './operation_update_members';

export type BitwardenV1GroupNode =
  | BitwardenV1GroupCreateNode
  | BitwardenV1GroupDeleteNode
  | BitwardenV1GroupGetNode
  | BitwardenV1GroupGetAllNode
  | BitwardenV1GroupGetMembersNode
  | BitwardenV1GroupUpdateNode
  | BitwardenV1GroupUpdateMembersNode
  ;