/**
 * Code Node - Version 2
 * Re-exports all discriminator combinations.
 */

import type { CodeV2RunOnceForAllItemsNode } from './mode_run_once_for_all_items';
import type { CodeV2RunOnceForEachItemNode } from './mode_run_once_for_each_item';

export * from './mode_run_once_for_all_items';
export * from './mode_run_once_for_each_item';

export type CodeV2Node =
  | CodeV2RunOnceForAllItemsNode
  | CodeV2RunOnceForEachItemNode
  ;