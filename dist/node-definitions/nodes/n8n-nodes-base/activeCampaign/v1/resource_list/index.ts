/**
 * ActiveCampaign - List Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1ListGetAllNode } from './operation_get_all';

export * from './operation_get_all';

export type ActiveCampaignV1ListNode = ActiveCampaignV1ListGetAllNode;