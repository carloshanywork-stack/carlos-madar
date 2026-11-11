/**
 * ActiveCampaign - ContactList Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1ContactListAddNode } from './operation_add';
import type { ActiveCampaignV1ContactListRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type ActiveCampaignV1ContactListNode =
  | ActiveCampaignV1ContactListAddNode
  | ActiveCampaignV1ContactListRemoveNode
  ;