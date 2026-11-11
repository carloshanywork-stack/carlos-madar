/**
 * Airtop - Session Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV1SessionCreateNode } from './operation_create';
import type { AirtopV1SessionSaveNode } from './operation_save';
import type { AirtopV1SessionTerminateNode } from './operation_terminate';
import type { AirtopV1SessionWaitForDownloadNode } from './operation_wait_for_download';

export * from './operation_create';
export * from './operation_save';
export * from './operation_terminate';
export * from './operation_wait_for_download';

export type AirtopV1SessionNode =
  | AirtopV1SessionCreateNode
  | AirtopV1SessionSaveNode
  | AirtopV1SessionTerminateNode
  | AirtopV1SessionWaitForDownloadNode
  ;