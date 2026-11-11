/**
 * ActiveCampaign - Connection Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1ConnectionCreateNode } from './operation_create';
import type { ActiveCampaignV1ConnectionDeleteNode } from './operation_delete';
import type { ActiveCampaignV1ConnectionGetNode } from './operation_get';
import type { ActiveCampaignV1ConnectionGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1ConnectionUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActiveCampaignV1ConnectionNode =
  | ActiveCampaignV1ConnectionCreateNode
  | ActiveCampaignV1ConnectionDeleteNode
  | ActiveCampaignV1ConnectionGetNode
  | ActiveCampaignV1ConnectionGetAllNode
  | ActiveCampaignV1ConnectionUpdateNode
  ;