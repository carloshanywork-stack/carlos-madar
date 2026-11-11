/**
 * AWS S3 Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AwsS3V1BucketNode } from './resource_bucket';
import type { AwsS3V1FileNode } from './resource_file';
import type { AwsS3V1FolderNode } from './resource_folder';

export * from './resource_bucket';
export * from './resource_file';
export * from './resource_folder';

export type AwsS3V1Node =
  | AwsS3V1BucketNode
  | AwsS3V1FileNode
  | AwsS3V1FolderNode
  ;