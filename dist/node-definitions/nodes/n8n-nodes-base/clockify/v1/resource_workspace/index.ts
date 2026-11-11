/**
 * Clockify - Workspace Resource
 * Re-exports all operation types for this resource.
 */

import type { ClockifyV1WorkspaceGetAllNode } from './operation_get_all';

export * from './operation_get_all';

export type ClockifyV1WorkspaceNode = ClockifyV1WorkspaceGetAllNode;