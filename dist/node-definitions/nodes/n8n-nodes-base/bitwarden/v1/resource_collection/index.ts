/**
 * Bitwarden - Collection Resource
 * Re-exports all operation types for this resource.
 */

import type { BitwardenV1CollectionDeleteNode } from './operation_delete';
import type { BitwardenV1CollectionGetNode } from './operation_get';
import type { BitwardenV1CollectionGetAllNode } from './operation_get_all';
import type { BitwardenV1CollectionUpdateNode } from './operation_update';

export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type BitwardenV1CollectionNode =
  | BitwardenV1CollectionDeleteNode
  | BitwardenV1CollectionGetNode
  | BitwardenV1CollectionGetAllNode
  | BitwardenV1CollectionUpdateNode
  ;