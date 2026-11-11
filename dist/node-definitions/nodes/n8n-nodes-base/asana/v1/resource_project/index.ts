/**
 * Asana - Project Resource
 * Re-exports all operation types for this resource.
 */

import type { AsanaV1ProjectCreateNode } from './operation_create';
import type { AsanaV1ProjectDeleteNode } from './operation_delete';
import type { AsanaV1ProjectGetNode } from './operation_get';
import type { AsanaV1ProjectGetAllNode } from './operation_get_all';
import type { AsanaV1ProjectUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AsanaV1ProjectNode =
  | AsanaV1ProjectCreateNode
  | AsanaV1ProjectDeleteNode
  | AsanaV1ProjectGetNode
  | AsanaV1ProjectGetAllNode
  | AsanaV1ProjectUpdateNode
  ;