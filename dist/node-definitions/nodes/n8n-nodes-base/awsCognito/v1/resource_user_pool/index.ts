/**
 * AWS Cognito - UserPool Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsCognitoV1UserPoolGetNode } from './operation_get';

export * from './operation_get';

export type AwsCognitoV1UserPoolNode = AwsCognitoV1UserPoolGetNode;