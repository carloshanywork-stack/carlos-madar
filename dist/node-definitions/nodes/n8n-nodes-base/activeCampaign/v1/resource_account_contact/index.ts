/**
 * ActiveCampaign - AccountContact Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1AccountContactCreateNode } from './operation_create';
import type { ActiveCampaignV1AccountContactDeleteNode } from './operation_delete';
import type { ActiveCampaignV1AccountContactUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_update';

export type ActiveCampaignV1AccountContactNode =
  | ActiveCampaignV1AccountContactCreateNode
  | ActiveCampaignV1AccountContactDeleteNode
  | ActiveCampaignV1AccountContactUpdateNode
  ;