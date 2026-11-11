/**
 * AWS ELB - LoadBalancer Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsElbV1LoadBalancerCreateNode } from './operation_create';
import type { AwsElbV1LoadBalancerDeleteNode } from './operation_delete';
import type { AwsElbV1LoadBalancerGetNode } from './operation_get';
import type { AwsElbV1LoadBalancerGetManyNode } from './operation_get_many';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_many';

export type AwsElbV1LoadBalancerNode =
  | AwsElbV1LoadBalancerCreateNode
  | AwsElbV1LoadBalancerDeleteNode
  | AwsElbV1LoadBalancerGetNode
  | AwsElbV1LoadBalancerGetManyNode
  ;