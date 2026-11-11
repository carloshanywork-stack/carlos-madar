/**
 * Azure Cosmos DB - Item Resource
 * Re-exports all operation types for this resource.
 */

import type { AzureCosmosDbV1ItemCreateNode } from './operation_create';
import type { AzureCosmosDbV1ItemDeleteNode } from './operation_delete';
import type { AzureCosmosDbV1ItemGetNode } from './operation_get';
import type { AzureCosmosDbV1ItemGetAllNode } from './operation_get_all';
import type { AzureCosmosDbV1ItemQueryNode } from './operation_query';
import type { AzureCosmosDbV1ItemUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_query';
export * from './operation_update';

export type AzureCosmosDbV1ItemNode =
  | AzureCosmosDbV1ItemCreateNode
  | AzureCosmosDbV1ItemDeleteNode
  | AzureCosmosDbV1ItemGetNode
  | AzureCosmosDbV1ItemGetAllNode
  | AzureCosmosDbV1ItemQueryNode
  | AzureCosmosDbV1ItemUpdateNode
  ;