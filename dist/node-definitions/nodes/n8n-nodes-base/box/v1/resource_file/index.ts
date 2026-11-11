/**
 * Box - File Resource
 * Re-exports all operation types for this resource.
 */

import type { BoxV1FileCopyNode } from './operation_copy';
import type { BoxV1FileDeleteNode } from './operation_delete';
import type { BoxV1FileDownloadNode } from './operation_download';
import type { BoxV1FileGetNode } from './operation_get';
import type { BoxV1FileSearchNode } from './operation_search';
import type { BoxV1FileShareNode } from './operation_share';
import type { BoxV1FileUploadNode } from './operation_upload';

export * from './operation_copy';
export * from './operation_delete';
export * from './operation_download';
export * from './operation_get';
export * from './operation_search';
export * from './operation_share';
export * from './operation_upload';

export type BoxV1FileNode =
  | BoxV1FileCopyNode
  | BoxV1FileDeleteNode
  | BoxV1FileDownloadNode
  | BoxV1FileGetNode
  | BoxV1FileSearchNode
  | BoxV1FileShareNode
  | BoxV1FileUploadNode
  ;