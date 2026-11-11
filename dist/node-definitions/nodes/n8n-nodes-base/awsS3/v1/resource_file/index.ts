/**
 * AWS S3 - File Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V1FileCopyNode } from './operation_copy';
import type { AwsS3V1FileDeleteNode } from './operation_delete';
import type { AwsS3V1FileDownloadNode } from './operation_download';
import type { AwsS3V1FileGetAllNode } from './operation_get_all';
import type { AwsS3V1FileUploadNode } from './operation_upload';

export * from './operation_copy';
export * from './operation_delete';
export * from './operation_download';
export * from './operation_get_all';
export * from './operation_upload';

export type AwsS3V1FileNode =
  | AwsS3V1FileCopyNode
  | AwsS3V1FileDeleteNode
  | AwsS3V1FileDownloadNode
  | AwsS3V1FileGetAllNode
  | AwsS3V1FileUploadNode
  ;