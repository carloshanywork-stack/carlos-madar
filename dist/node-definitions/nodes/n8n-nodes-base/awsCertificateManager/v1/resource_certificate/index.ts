/**
 * AWS Certificate Manager - Certificate Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsCertificateManagerV1CertificateDeleteNode } from './operation_delete';
import type { AwsCertificateManagerV1CertificateGetNode } from './operation_get';
import type { AwsCertificateManagerV1CertificateGetManyNode } from './operation_get_many';
import type { AwsCertificateManagerV1CertificateGetMetadataNode } from './operation_get_metadata';
import type { AwsCertificateManagerV1CertificateRenewNode } from './operation_renew';

export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_many';
export * from './operation_get_metadata';
export * from './operation_renew';

export type AwsCertificateManagerV1CertificateNode =
  | AwsCertificateManagerV1CertificateDeleteNode
  | AwsCertificateManagerV1CertificateGetNode
  | AwsCertificateManagerV1CertificateGetManyNode
  | AwsCertificateManagerV1CertificateGetMetadataNode
  | AwsCertificateManagerV1CertificateRenewNode
  ;