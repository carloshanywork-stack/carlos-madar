/**
 * Netscaler ADC - Certificate Resource
 * Re-exports all operation types for this resource.
 */

import type { CitrixAdcV1CertificateCreateNode } from './operation_create';
import type { CitrixAdcV1CertificateInstallNode } from './operation_install';

export * from './operation_create';
export * from './operation_install';

export type CitrixAdcV1CertificateNode =
  | CitrixAdcV1CertificateCreateNode
  | CitrixAdcV1CertificateInstallNode
  ;