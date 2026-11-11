/**
 * ActiveCampaign - Contact Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1ContactCreateNode } from './operation_create';
import type { ActiveCampaignV1ContactDeleteNode } from './operation_delete';
import type { ActiveCampaignV1ContactGetNode } from './operation_get';
import type { ActiveCampaignV1ContactGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1ContactUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActiveCampaignV1ContactNode =
  | ActiveCampaignV1ContactCreateNode
  | ActiveCampaignV1ContactDeleteNode
  | ActiveCampaignV1ContactGetNode
  | ActiveCampaignV1ContactGetAllNode
  | ActiveCampaignV1ContactUpdateNode
  ;