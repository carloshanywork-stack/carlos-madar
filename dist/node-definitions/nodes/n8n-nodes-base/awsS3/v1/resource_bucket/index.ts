/**
 * AWS S3 - Bucket Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V1BucketCreateNode } from './operation_create';
import type { AwsS3V1BucketDeleteNode } from './operation_delete';
import type { AwsS3V1BucketGetAllNode } from './operation_get_all';
import type { AwsS3V1BucketSearchNode } from './operation_search';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';
export * from './operation_search';

export type AwsS3V1BucketNode =
  | AwsS3V1BucketCreateNode
  | AwsS3V1BucketDeleteNode
  | AwsS3V1BucketGetAllNode
  | AwsS3V1BucketSearchNode
  ;