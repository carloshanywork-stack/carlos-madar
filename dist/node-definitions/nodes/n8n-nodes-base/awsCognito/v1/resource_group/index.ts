/**
 * AWS Cognito - Group Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsCognitoV1GroupCreateNode } from './operation_create';
import type { AwsCognitoV1GroupDeleteNode } from './operation_delete';
import type { AwsCognitoV1GroupGetNode } from './operation_get';
import type { AwsCognitoV1GroupGetAllNode } from './operation_get_all';
import type { AwsCognitoV1GroupUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AwsCognitoV1GroupNode =
  | AwsCognitoV1GroupCreateNode
  | AwsCognitoV1GroupDeleteNode
  | AwsCognitoV1GroupGetNode
  | AwsCognitoV1GroupGetAllNode
  | AwsCognitoV1GroupUpdateNode
  ;