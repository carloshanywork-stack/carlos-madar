/**
 * AWS IAM - Group Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsIamV1GroupCreateNode } from './operation_create';
import type { AwsIamV1GroupDeleteNode } from './operation_delete';
import type { AwsIamV1GroupGetNode } from './operation_get';
import type { AwsIamV1GroupGetAllNode } from './operation_get_all';
import type { AwsIamV1GroupUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AwsIamV1GroupNode =
  | AwsIamV1GroupCreateNode
  | AwsIamV1GroupDeleteNode
  | AwsIamV1GroupGetNode
  | AwsIamV1GroupGetAllNode
  | AwsIamV1GroupUpdateNode
  ;