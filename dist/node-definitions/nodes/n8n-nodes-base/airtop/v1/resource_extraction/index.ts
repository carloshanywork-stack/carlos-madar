/**
 * Airtop - Extraction Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV1ExtractionGetPaginatedNode } from './operation_get_paginated';
import type { AirtopV1ExtractionQueryNode } from './operation_query';
import type { AirtopV1ExtractionScrapeNode } from './operation_scrape';

export * from './operation_get_paginated';
export * from './operation_query';
export * from './operation_scrape';

export type AirtopV1ExtractionNode =
  | AirtopV1ExtractionGetPaginatedNode
  | AirtopV1ExtractionQueryNode
  | AirtopV1ExtractionScrapeNode
  ;