/**
 * Bannerbear - Template Resource
 * Re-exports all operation types for this resource.
 */

import type { BannerbearV1TemplateGetNode } from './operation_get';
import type { BannerbearV1TemplateGetAllNode } from './operation_get_all';

export * from './operation_get';
export * from './operation_get_all';

export type BannerbearV1TemplateNode =
  | BannerbearV1TemplateGetNode
  | BannerbearV1TemplateGetAllNode
  ;