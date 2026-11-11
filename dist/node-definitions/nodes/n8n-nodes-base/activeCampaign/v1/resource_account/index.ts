/**
 * ActiveCampaign - Account Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1AccountCreateNode } from './operation_create';
import type { ActiveCampaignV1AccountDeleteNode } from './operation_delete';
import type { ActiveCampaignV1AccountGetNode } from './operation_get';
import type { ActiveCampaignV1AccountGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1AccountUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActiveCampaignV1AccountNode =
  | ActiveCampaignV1AccountCreateNode
  | ActiveCampaignV1AccountDeleteNode
  | ActiveCampaignV1AccountGetNode
  | ActiveCampaignV1AccountGetAllNode
  | ActiveCampaignV1AccountUpdateNode
  ;