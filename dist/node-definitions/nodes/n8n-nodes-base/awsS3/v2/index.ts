/**
 * AWS S3 Node - Version 2
 * Re-exports all discriminator combinations.
 */

import type { AwsS3V2BucketNode } from './resource_bucket';
import type { AwsS3V2FileNode } from './resource_file';
import type { AwsS3V2FolderNode } from './resource_folder';

export * from './resource_bucket';
export * from './resource_file';
export * from './resource_folder';

export type AwsS3V2Node =
  | AwsS3V2BucketNode
  | AwsS3V2FileNode
  | AwsS3V2FolderNode
  ;