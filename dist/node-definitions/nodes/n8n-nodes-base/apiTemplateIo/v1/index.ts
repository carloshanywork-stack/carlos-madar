/**
 * APITemplate.io Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ApiTemplateIoV1AccountNode } from './resource_account';
import type { ApiTemplateIoV1ImageNode } from './resource_image';
import type { ApiTemplateIoV1PdfNode } from './resource_pdf';

export * from './resource_account';
export * from './resource_image';
export * from './resource_pdf';

export type ApiTemplateIoV1Node =
  | ApiTemplateIoV1AccountNode
  | ApiTemplateIoV1ImageNode
  | ApiTemplateIoV1PdfNode
  ;