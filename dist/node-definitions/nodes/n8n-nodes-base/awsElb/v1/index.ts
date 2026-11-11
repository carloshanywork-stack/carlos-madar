/**
 * AWS ELB Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AwsElbV1ListenerCertificateNode } from './resource_listener_certificate';
import type { AwsElbV1LoadBalancerNode } from './resource_load_balancer';

export * from './resource_listener_certificate';
export * from './resource_load_balancer';

export type AwsElbV1Node =
  | AwsElbV1ListenerCertificateNode
  | AwsElbV1LoadBalancerNode
  ;