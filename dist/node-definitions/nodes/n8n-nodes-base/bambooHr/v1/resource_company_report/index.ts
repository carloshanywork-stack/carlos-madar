/**
 * BambooHR - CompanyReport Resource
 * Re-exports all operation types for this resource.
 */

import type { BambooHrV1CompanyReportGetNode } from './operation_get';

export * from './operation_get';

export type BambooHrV1CompanyReportNode = BambooHrV1CompanyReportGetNode;