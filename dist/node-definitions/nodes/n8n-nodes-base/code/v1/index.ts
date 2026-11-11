/**
 * Code Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CodeV1RunOnceForAllItemsNode } from './mode_run_once_for_all_items';
import type { CodeV1RunOnceForEachItemNode } from './mode_run_once_for_each_item';

export * from './mode_run_once_for_all_items';
export * from './mode_run_once_for_each_item';

export type CodeV1Node =
  | CodeV1RunOnceForAllItemsNode
  | CodeV1RunOnceForEachItemNode
  ;