/**
 * Airtop - Window Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV1WindowCloseNode } from './operation_close';
import type { AirtopV1WindowCreateNode } from './operation_create';
import type { AirtopV1WindowGetLiveViewNode } from './operation_get_live_view';
import type { AirtopV1WindowListNode } from './operation_list';
import type { AirtopV1WindowLoadNode } from './operation_load';
import type { AirtopV1WindowTakeScreenshotNode } from './operation_take_screenshot';

export * from './operation_close';
export * from './operation_create';
export * from './operation_get_live_view';
export * from './operation_list';
export * from './operation_load';
export * from './operation_take_screenshot';

export type AirtopV1WindowNode =
  | AirtopV1WindowCloseNode
  | AirtopV1WindowCreateNode
  | AirtopV1WindowGetLiveViewNode
  | AirtopV1WindowListNode
  | AirtopV1WindowLoadNode
  | AirtopV1WindowTakeScreenshotNode
  ;