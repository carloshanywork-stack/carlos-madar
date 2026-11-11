/**
 * Agile CRM Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AgileCrmV1CompanyNode } from './resource_company';
import type { AgileCrmV1ContactNode } from './resource_contact';
import type { AgileCrmV1DealNode } from './resource_deal';

export * from './resource_company';
export * from './resource_contact';
export * from './resource_deal';

export type AgileCrmV1Node =
  | AgileCrmV1CompanyNode
  | AgileCrmV1ContactNode
  | AgileCrmV1DealNode
  ;