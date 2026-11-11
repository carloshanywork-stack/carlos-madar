/**
 * Clearbit Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { ClearbitV1CompanyNode } from './resource_company';
import type { ClearbitV1PersonNode } from './resource_person';

export * from './resource_company';
export * from './resource_person';

export type ClearbitV1Node =
  | ClearbitV1CompanyNode
  | ClearbitV1PersonNode
  ;