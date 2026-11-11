/**
 * AWS S3 - Folder Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V2FolderCreateNode } from './operation_create';
import type { AwsS3V2FolderDeleteNode } from './operation_delete';
import type { AwsS3V2FolderGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';

export type AwsS3V2FolderNode =
  | AwsS3V2FolderCreateNode
  | AwsS3V2FolderDeleteNode
  | AwsS3V2FolderGetAllNode
  ;