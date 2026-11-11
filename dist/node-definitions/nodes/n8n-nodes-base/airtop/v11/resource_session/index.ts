/**
 * Airtop - Session Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV11SessionCreateNode } from './operation_create';
import type { AirtopV11SessionSaveNode } from './operation_save';
import type { AirtopV11SessionTerminateNode } from './operation_terminate';
import type { AirtopV11SessionWaitForDownloadNode } from './operation_wait_for_download';

export * from './operation_create';
export * from './operation_save';
export * from './operation_terminate';
export * from './operation_wait_for_download';

export type AirtopV11SessionNode =
  | AirtopV11SessionCreateNode
  | AirtopV11SessionSaveNode
  | AirtopV11SessionTerminateNode
  | AirtopV11SessionWaitForDownloadNode
  ;