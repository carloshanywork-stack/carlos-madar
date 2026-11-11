/**
 * AWS IAM Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AwsIamV1UserNode } from './resource_user';
import type { AwsIamV1GroupNode } from './resource_group';

export * from './resource_user';
export * from './resource_group';

export type AwsIamV1Node =
  | AwsIamV1UserNode
  | AwsIamV1GroupNode
  ;