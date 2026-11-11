/**
 * Azure Storage - Container Resource
 * Re-exports all operation types for this resource.
 */

import type { AzureStorageV1ContainerCreateNode } from './operation_create';
import type { AzureStorageV1ContainerDeleteNode } from './operation_delete';
import type { AzureStorageV1ContainerGetNode } from './operation_get';
import type { AzureStorageV1ContainerGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';

export type AzureStorageV1ContainerNode =
  | AzureStorageV1ContainerCreateNode
  | AzureStorageV1ContainerDeleteNode
  | AzureStorageV1ContainerGetNode
  | AzureStorageV1ContainerGetAllNode
  ;