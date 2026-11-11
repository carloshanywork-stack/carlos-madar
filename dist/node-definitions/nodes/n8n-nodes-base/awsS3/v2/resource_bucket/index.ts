/**
 * AWS S3 - Bucket Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsS3V2BucketCreateNode } from './operation_create';
import type { AwsS3V2BucketDeleteNode } from './operation_delete';
import type { AwsS3V2BucketGetAllNode } from './operation_get_all';
import type { AwsS3V2BucketSearchNode } from './operation_search';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get_all';
export * from './operation_search';

export type AwsS3V2BucketNode =
  | AwsS3V2BucketCreateNode
  | AwsS3V2BucketDeleteNode
  | AwsS3V2BucketGetAllNode
  | AwsS3V2BucketSearchNode
  ;