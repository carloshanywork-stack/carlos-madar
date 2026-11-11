/**
 * ActiveCampaign - Tag Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1TagCreateNode } from './operation_create';
import type { ActiveCampaignV1TagDeleteNode } from './operation_delete';
import type { ActiveCampaignV1TagGetNode } from './operation_get';
import type { ActiveCampaignV1TagGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1TagUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActiveCampaignV1TagNode =
  | ActiveCampaignV1TagCreateNode
  | ActiveCampaignV1TagDeleteNode
  | ActiveCampaignV1TagGetNode
  | ActiveCampaignV1TagGetAllNode
  | ActiveCampaignV1TagUpdateNode
  ;