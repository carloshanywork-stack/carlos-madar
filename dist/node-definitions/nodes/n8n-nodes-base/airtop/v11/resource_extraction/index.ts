/**
 * Airtop - Extraction Resource
 * Re-exports all operation types for this resource.
 */

import type { AirtopV11ExtractionGetPaginatedNode } from './operation_get_paginated';
import type { AirtopV11ExtractionQueryNode } from './operation_query';
import type { AirtopV11ExtractionScrapeNode } from './operation_scrape';

export * from './operation_get_paginated';
export * from './operation_query';
export * from './operation_scrape';

export type AirtopV11ExtractionNode =
  | AirtopV11ExtractionGetPaginatedNode
  | AirtopV11ExtractionQueryNode
  | AirtopV11ExtractionScrapeNode
  ;