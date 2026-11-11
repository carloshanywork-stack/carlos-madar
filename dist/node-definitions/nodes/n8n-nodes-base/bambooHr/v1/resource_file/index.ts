/**
 * BambooHR - File Resource
 * Re-exports all operation types for this resource.
 */

import type { BambooHrV1FileDeleteNode } from './operation_delete';
import type { BambooHrV1FileDownloadNode } from './operation_download';
import type { BambooHrV1FileGetAllNode } from './operation_get_all';
import type { BambooHrV1FileUpdateNode } from './operation_update';
import type { BambooHrV1FileUploadNode } from './operation_upload';

export * from './operation_delete';
export * from './operation_download';
export * from './operation_get_all';
export * from './operation_update';
export * from './operation_upload';

export type BambooHrV1FileNode =
  | BambooHrV1FileDeleteNode
  | BambooHrV1FileDownloadNode
  | BambooHrV1FileGetAllNode
  | BambooHrV1FileUpdateNode
  | BambooHrV1FileUploadNode
  ;