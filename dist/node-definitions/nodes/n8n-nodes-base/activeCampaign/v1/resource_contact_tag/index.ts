/**
 * ActiveCampaign - ContactTag Resource
 * Re-exports all operation types for this resource.
 */

import type { ActiveCampaignV1ContactTagAddNode } from './operation_add';
import type { ActiveCampaignV1ContactTagRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_remove';

export type ActiveCampaignV1ContactTagNode =
  | ActiveCampaignV1ContactTagAddNode
  | ActiveCampaignV1ContactTagRemoveNode
  ;