/**
 * Bannerbear Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { BannerbearV1ImageNode } from './resource_image';
import type { BannerbearV1TemplateNode } from './resource_template';

export * from './resource_image';
export * from './resource_template';

export type BannerbearV1Node =
  | BannerbearV1ImageNode
  | BannerbearV1TemplateNode
  ;