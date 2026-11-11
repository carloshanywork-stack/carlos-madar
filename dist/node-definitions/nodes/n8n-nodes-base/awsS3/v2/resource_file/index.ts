/**
 * AWS S3 - File Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V2FileCopyNode } from './operation_copy';
import type { AwsS3V2FileDeleteNode } from './operation_delete';
import type { AwsS3V2FileDownloadNode } from './operation_download';
import type { AwsS3V2FileGetAllNode } from './operation_get_all';
import type { AwsS3V2FileUploadNode } from './operation_upload';

export * from './operation_copy';
export * from './operation_delete';
export * from './operation_download';
export * from './operation_get_all';
export * from './operation_upload';

export type AwsS3V2FileNode =
  | AwsS3V2FileCopyNode
  | AwsS3V2FileDeleteNode
  | AwsS3V2FileDownloadNode
  | AwsS3V2FileGetAllNode
  | AwsS3V2FileUploadNode
  ;