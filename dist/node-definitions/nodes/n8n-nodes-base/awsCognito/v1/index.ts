/**
 * AWS Cognito Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AwsCognitoV1GroupNode } from './resource_group';
import type { AwsCognitoV1UserNode } from './resource_user';
import type { AwsCognitoV1UserPoolNode } from './resource_user_pool';

export * from './resource_group';
export * from './resource_user';
export * from './resource_user_pool';

export type AwsCognitoV1Node =
  | AwsCognitoV1GroupNode
  | AwsCognitoV1UserNode
  | AwsCognitoV1UserPoolNode
  ;