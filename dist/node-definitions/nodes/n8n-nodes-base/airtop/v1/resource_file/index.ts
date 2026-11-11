/**
 * Airtop - File Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV1FileDeleteFileNode } from './operation_delete_file';
import type { AirtopV1FileGetNode } from './operation_get';
import type { AirtopV1FileGetManyNode } from './operation_get_many';
import type { AirtopV1FileLoadNode } from './operation_load';
import type { AirtopV1FileUploadNode } from './operation_upload';

export * from './operation_delete_file';
export * from './operation_get';
export * from './operation_get_many';
export * from './operation_load';
export * from './operation_upload';

export type AirtopV1FileNode =
  | AirtopV1FileDeleteFileNode
  | AirtopV1FileGetNode
  | AirtopV1FileGetManyNode
  | AirtopV1FileLoadNode
  | AirtopV1FileUploadNode
  ;