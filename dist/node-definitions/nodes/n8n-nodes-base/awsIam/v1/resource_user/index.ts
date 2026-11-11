/**
 * AWS IAM - User Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsIamV1UserAddToGroupNode } from './operation_add_to_group';
import type { AwsIamV1UserCreateNode } from './operation_create';
import type { AwsIamV1UserDeleteNode } from './operation_delete';
import type { AwsIamV1UserGetNode } from './operation_get';
import type { AwsIamV1UserGetAllNode } from './operation_get_all';
import type { AwsIamV1UserRemoveFromGroupNode } from './operation_remove_from_group';
import type { AwsIamV1UserUpdateNode } from './operation_update';

export * from './operation_add_to_group';
export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_remove_from_group';
export * from './operation_update';

export type AwsIamV1UserNode =
  | AwsIamV1UserAddToGroupNode
  | AwsIamV1UserCreateNode
  | AwsIamV1UserDeleteNode
  | AwsIamV1UserGetNode
  | AwsIamV1UserGetAllNode
  | AwsIamV1UserRemoveFromGroupNode
  | AwsIamV1UserUpdateNode
  ;