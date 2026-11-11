/**
 * Azure Cosmos DB Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AzureCosmosDbV1ContainerNode } from './resource_container';
import type { AzureCosmosDbV1ItemNode } from './resource_item';

export * from './resource_container';
export * from './resource_item';

export type AzureCosmosDbV1Node =
  | AzureCosmosDbV1ContainerNode
  | AzureCosmosDbV1ItemNode
  ;