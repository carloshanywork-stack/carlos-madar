/**
 * Airtop - Interaction Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV1InteractionClickNode } from './operation_click';
import type { AirtopV1InteractionFillNode } from './operation_fill';
import type { AirtopV1InteractionHoverNode } from './operation_hover';
import type { AirtopV1InteractionScrollNode } from './operation_scroll';
import type { AirtopV1InteractionTypeNode } from './operation_type';

export * from './operation_click';
export * from './operation_fill';
export * from './operation_hover';
export * from './operation_scroll';
export * from './operation_type';

export type AirtopV1InteractionNode =
  | AirtopV1InteractionClickNode
  | AirtopV1InteractionFillNode
  | AirtopV1InteractionHoverNode
  | AirtopV1InteractionScrollNode
  | AirtopV1InteractionTypeNode
  ;