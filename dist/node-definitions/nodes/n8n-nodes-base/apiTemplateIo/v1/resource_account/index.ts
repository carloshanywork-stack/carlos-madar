/**
 * APITemplate.io - Account Resource
 * Re-exports all operation types for this resource.
 */

import type { ApiTemplateIoV1AccountGetNode } from './operation_get';

export * from './operation_get';

export type ApiTemplateIoV1AccountNode = ApiTemplateIoV1AccountGetNode;