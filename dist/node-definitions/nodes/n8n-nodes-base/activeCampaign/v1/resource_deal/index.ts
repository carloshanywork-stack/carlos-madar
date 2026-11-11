/**
 * ActiveCampaign - Deal Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1DealCreateNode } from './operation_create';
import type { ActiveCampaignV1DealCreateNoteNode } from './operation_create_note';
import type { ActiveCampaignV1DealDeleteNode } from './operation_delete';
import type { ActiveCampaignV1DealGetNode } from './operation_get';
import type { ActiveCampaignV1DealGetAllNode } from './operation_get_all';
import type { ActiveCampaignV1DealUpdateNode } from './operation_update';
import type { ActiveCampaignV1DealUpdateNoteNode } from './operation_update_note';

export * from './operation_create';
export * from './operation_create_note';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';
export * from './operation_update_note';

export type ActiveCampaignV1DealNode =
  | ActiveCampaignV1DealCreateNode
  | ActiveCampaignV1DealCreateNoteNode
  | ActiveCampaignV1DealDeleteNode
  | ActiveCampaignV1DealGetNode
  | ActiveCampaignV1DealGetAllNode
  | ActiveCampaignV1DealUpdateNode
  | ActiveCampaignV1DealUpdateNoteNode
  ;