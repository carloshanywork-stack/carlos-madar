/**
 * AWS ELB - ListenerCertificate Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsElbV1ListenerCertificateAddNode } from './operation_add';
import type { AwsElbV1ListenerCertificateGetManyNode } from './operation_get_many';
import type { AwsElbV1ListenerCertificateRemoveNode } from './operation_remove';

export * from './operation_add';
export * from './operation_get_many';
export * from './operation_remove';

export type AwsElbV1ListenerCertificateNode =
  | AwsElbV1ListenerCertificateAddNode
  | AwsElbV1ListenerCertificateGetManyNode
  | AwsElbV1ListenerCertificateRemoveNode
  ;