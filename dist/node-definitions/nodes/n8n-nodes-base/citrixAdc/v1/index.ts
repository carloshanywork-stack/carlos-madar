/**
 * Netscaler ADC Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CitrixAdcV1CertificateNode } from './resource_certificate';
import type { CitrixAdcV1FileNode } from './resource_file';

export * from './resource_certificate';
export * from './resource_file';

export type CitrixAdcV1Node =
  | CitrixAdcV1CertificateNode
  | CitrixAdcV1FileNode
  ;