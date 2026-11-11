/**
 * Azure Cosmos DB - Container Resource
 * Re-exports all operation types for this resource.
 */

import type { AzureCosmosDbV1ContainerCreateNode } from './operation_create';
import type { AzureCosmosDbV1ContainerDeleteNode } from './operation_delete';
import type { AzureCosmosDbV1ContainerGetNode } from './operation_get';
import type { AzureCosmosDbV1ContainerGetAllNode } from './operation_get_all';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';

export type AzureCosmosDbV1ContainerNode =
  | AzureCosmosDbV1ContainerCreateNode
  | AzureCosmosDbV1ContainerDeleteNode
  | AzureCosmosDbV1ContainerGetNode
  | AzureCosmosDbV1ContainerGetAllNode
  ;