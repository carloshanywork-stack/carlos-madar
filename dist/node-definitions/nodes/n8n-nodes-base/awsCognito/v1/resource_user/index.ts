/**
 * AWS Cognito - User Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsCognitoV1UserAddToGroupNode } from './operation_add_to_group';
import type { AwsCognitoV1UserCreateNode } from './operation_create';
import type { AwsCognitoV1UserDeleteNode } from './operation_delete';
import type { AwsCognitoV1UserGetNode } from './operation_get';
import type { AwsCognitoV1UserGetAllNode } from './operation_get_all';
import type { AwsCognitoV1UserRemoveFromGroupNode } from './operation_remove_from_group';
import type { AwsCognitoV1UserUpdateNode } from './operation_update';

export * from './operation_add_to_group';
export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_remove_from_group';
export * from './operation_update';

export type AwsCognitoV1UserNode =
  | AwsCognitoV1UserAddToGroupNode
  | AwsCognitoV1UserCreateNode
  | AwsCognitoV1UserDeleteNode
  | AwsCognitoV1UserGetNode
  | AwsCognitoV1UserGetAllNode
  | AwsCognitoV1UserRemoveFromGroupNode
  | AwsCognitoV1UserUpdateNode
  ;