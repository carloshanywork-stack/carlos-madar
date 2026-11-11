/**
 * BambooHR - EmployeeDocument Resource
 * Re-exports all operation types for this resource.
 */

import type { BambooHrV1EmployeeDocumentDeleteNode } from './operation_delete';
import type { BambooHrV1EmployeeDocumentDownloadNode } from './operation_download';
import type { BambooHrV1EmployeeDocumentGetAllNode } from './operation_get_all';
import type { BambooHrV1EmployeeDocumentUpdateNode } from './operation_update';
import type { BambooHrV1EmployeeDocumentUploadNode } from './operation_upload';

export * from './operation_delete';
export * from './operation_download';
export * from './operation_get_all';
export * from './operation_update';
export * from './operation_upload';

export type BambooHrV1EmployeeDocumentNode =
  | BambooHrV1EmployeeDocumentDeleteNode
  | BambooHrV1EmployeeDocumentDownloadNode
  | BambooHrV1EmployeeDocumentGetAllNode
  | BambooHrV1EmployeeDocumentUpdateNode
  | BambooHrV1EmployeeDocumentUploadNode
  ;