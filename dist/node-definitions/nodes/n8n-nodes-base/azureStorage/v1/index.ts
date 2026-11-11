/**
 * Azure Storage Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AzureStorageV1BlobNode } from './resource_blob';
import type { AzureStorageV1ContainerNode } from './resource_container';

export * from './resource_blob';
export * from './resource_container';

export type AzureStorageV1Node =
  | AzureStorageV1BlobNode
  | AzureStorageV1ContainerNode
  ;