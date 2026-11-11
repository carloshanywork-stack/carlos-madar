/**
 * ActiveCampaign Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ActiveCampaignV1AccountNode } from './resource_account';
import type { ActiveCampaignV1AccountContactNode } from './resource_account_contact';
import type { ActiveCampaignV1ConnectionNode } from './resource_connection';
import type { ActiveCampaignV1ContactNode } from './resource_contact';
import type { ActiveCampaignV1ContactListNode } from './resource_contact_list';
import type { ActiveCampaignV1ContactTagNode } from './resource_contact_tag';
import type { ActiveCampaignV1DealNode } from './resource_deal';
import type { ActiveCampaignV1EcommerceCustomerNode } from './resource_ecommerce_customer';
import type { ActiveCampaignV1EcommerceOrderNode } from './resource_ecommerce_order';
import type { ActiveCampaignV1EcommerceOrderProductsNode } from './resource_ecommerce_order_products';
import type { ActiveCampaignV1ListNode } from './resource_list';
import type { ActiveCampaignV1TagNode } from './resource_tag';

export * from './resource_account';
export * from './resource_account_contact';
export * from './resource_connection';
export * from './resource_contact';
export * from './resource_contact_list';
export * from './resource_contact_tag';
export * from './resource_deal';
export * from './resource_ecommerce_customer';
export * from './resource_ecommerce_order';
export * from './resource_ecommerce_order_products';
export * from './resource_list';
export * from './resource_tag';

export type ActiveCampaignV1Node =
  | ActiveCampaignV1AccountNode
  | ActiveCampaignV1AccountContactNode
  | ActiveCampaignV1ConnectionNode
  | ActiveCampaignV1ContactNode
  | ActiveCampaignV1ContactListNode
  | ActiveCampaignV1ContactTagNode
  | ActiveCampaignV1DealNode
  | ActiveCampaignV1EcommerceCustomerNode
  | ActiveCampaignV1EcommerceOrderNode
  | ActiveCampaignV1EcommerceOrderProductsNode
  | ActiveCampaignV1ListNode
  | ActiveCampaignV1TagNode
  ;