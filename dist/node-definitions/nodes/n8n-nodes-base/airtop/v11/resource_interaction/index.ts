/**
 * Airtop - Interaction Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV11InteractionClickNode } from './operation_click';
import type { AirtopV11InteractionFillNode } from './operation_fill';
import type { AirtopV11InteractionHoverNode } from './operation_hover';
import type { AirtopV11InteractionScrollNode } from './operation_scroll';
import type { AirtopV11InteractionTypeNode } from './operation_type';

export * from './operation_click';
export * from './operation_fill';
export * from './operation_hover';
export * from './operation_scroll';
export * from './operation_type';

export type AirtopV11InteractionNode =
  | AirtopV11InteractionClickNode
  | AirtopV11InteractionFillNode
  | AirtopV11InteractionHoverNode
  | AirtopV11InteractionScrollNode
  | AirtopV11InteractionTypeNode
  ;