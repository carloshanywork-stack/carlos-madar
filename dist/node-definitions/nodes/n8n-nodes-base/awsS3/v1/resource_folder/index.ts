/**
 * AWS S3 - Folder Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V1FolderCreateNode } from './operation_create';
import type { AwsS3V1FolderDeleteNode } from './operation_delete';
import type { AwsS3V1FolderGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';

export type AwsS3V1FolderNode =
  | AwsS3V1FolderCreateNode
  | AwsS3V1FolderDeleteNode
  | AwsS3V1FolderGetAllNode
  ;