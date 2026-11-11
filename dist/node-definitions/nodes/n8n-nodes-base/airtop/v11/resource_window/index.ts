/**
 * Airtop - Window Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV11WindowCloseNode } from './operation_close';
import type { AirtopV11WindowCreateNode } from './operation_create';
import type { AirtopV11WindowGetLiveViewNode } from './operation_get_live_view';
import type { AirtopV11WindowListNode } from './operation_list';
import type { AirtopV11WindowLoadNode } from './operation_load';
import type { AirtopV11WindowTakeScreenshotNode } from './operation_take_screenshot';

export * from './operation_close';
export * from './operation_create';
export * from './operation_get_live_view';
export * from './operation_list';
export * from './operation_load';
export * from './operation_take_screenshot';

export type AirtopV11WindowNode =
  | AirtopV11WindowCloseNode
  | AirtopV11WindowCreateNode
  | AirtopV11WindowGetLiveViewNode
  | AirtopV11WindowListNode
  | AirtopV11WindowLoadNode
  | AirtopV11WindowTakeScreenshotNode
  ;