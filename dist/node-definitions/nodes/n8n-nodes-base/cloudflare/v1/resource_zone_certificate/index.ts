/**
 * Cloudflare - ZoneCertificate Resource
 * Re-exports all operation types for this resource.
 */

import type { CloudflareV1ZoneCertificateDeleteNode } from './operation_delete';
import type { CloudflareV1ZoneCertificateGetNode } from './operation_get';
import type { CloudflareV1ZoneCertificateGetManyNode } from './operation_get_many';
import type { CloudflareV1ZoneCertificateUploadNode } from './operation_upload';

export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_many';
export * from './operation_upload';

export type CloudflareV1ZoneCertificateNode =
  | CloudflareV1ZoneCertificateDeleteNode
  | CloudflareV1ZoneCertificateGetNode
  | CloudflareV1ZoneCertificateGetManyNode
  | CloudflareV1ZoneCertificateUploadNode
  ;