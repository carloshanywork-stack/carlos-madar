/**
 * Netscaler ADC - File Resource
 * Re-exports all operation types for this resource.
 */

import type { CitrixAdcV1FileDeleteNode } from './operation_delete';
import type { CitrixAdcV1FileDownloadNode } from './operation_download';
import type { CitrixAdcV1FileUploadNode } from './operation_upload';

export * from './operation_delete';
export * from './operation_download';
export * from './operation_upload';

export type CitrixAdcV1FileNode =
  | CitrixAdcV1FileDeleteNode
  | CitrixAdcV1FileDownloadNode
  | CitrixAdcV1FileUploadNode
  ;