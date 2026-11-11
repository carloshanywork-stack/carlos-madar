/**
 * Airtop - File Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV11FileDeleteFileNode } from './operation_delete_file';
import type { AirtopV11FileGetNode } from './operation_get';
import type { AirtopV11FileGetManyNode } from './operation_get_many';
import type { AirtopV11FileLoadNode } from './operation_load';
import type { AirtopV11FileUploadNode } from './operation_upload';

export * from './operation_delete_file';
export * from './operation_get';
export * from './operation_get_many';
export * from './operation_load';
export * from './operation_upload';

export type AirtopV11FileNode =
  | AirtopV11FileDeleteFileNode
  | AirtopV11FileGetNode
  | AirtopV11FileGetManyNode
  | AirtopV11FileLoadNode
  | AirtopV11FileUploadNode
  ;