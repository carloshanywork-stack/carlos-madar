/**
 * Azure Storage - Blob Resource
 * Re-exports all operation types for this resource.
 */

import type { AzureStorageV1BlobCreateNode } from './operation_create';
import type { AzureStorageV1BlobDeleteNode } from './operation_delete';
import type { AzureStorageV1BlobGetNode } from './operation_get';
import type { AzureStorageV1BlobGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';

export type AzureStorageV1BlobNode =
  | AzureStorageV1BlobCreateNode
  | AzureStorageV1BlobDeleteNode
  | AzureStorageV1BlobGetNode
  | AzureStorageV1BlobGetAllNode
  ;