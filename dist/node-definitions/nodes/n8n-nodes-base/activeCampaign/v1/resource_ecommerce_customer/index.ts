/**
 * ActiveCampaign - EcommerceCustomer Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1EcommerceCustomerCreateNode } from './operation_create';
import type { ActiveCampaignV1EcommerceCustomerDeleteNode } from './operation_delete';
import type { ActiveCampaignV1EcommerceCustomerGetNode } from './operation_get';
import type { ActiveCampaignV1EcommerceCustomerGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1EcommerceCustomerUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type ActiveCampaignV1EcommerceCustomerNode =
  | ActiveCampaignV1EcommerceCustomerCreateNode
  | ActiveCampaignV1EcommerceCustomerDeleteNode
  | ActiveCampaignV1EcommerceCustomerGetNode
  | ActiveCampaignV1EcommerceCustomerGetAllNode
  | ActiveCampaignV1EcommerceCustomerUpdateNode
  ;