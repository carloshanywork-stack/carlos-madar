/**
 * AWS DynamoDB - Item Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsDynamoDbV1ItemDeleteNode } from './operation_delete';
import type { AwsDynamoDbV1ItemGetNode } from './operation_get';
import type { AwsDynamoDbV1ItemGetAllNode } from './operation_get_all';
import type { AwsDynamoDbV1ItemUpsertNode } from './operation_upsert';

export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_upsert';

export type AwsDynamoDbV1ItemNode =
  | AwsDynamoDbV1ItemDeleteNode
  | AwsDynamoDbV1ItemGetNode
  | AwsDynamoDbV1ItemGetAllNode
  | AwsDynamoDbV1ItemUpsertNode
  ;