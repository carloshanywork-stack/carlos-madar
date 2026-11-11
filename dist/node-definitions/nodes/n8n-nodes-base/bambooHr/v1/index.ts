/**
 * BambooHR Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { BambooHrV1CompanyReportNode } from './resource_company_report';
import type { BambooHrV1EmployeeNode } from './resource_employee';
import type { BambooHrV1EmployeeDocumentNode } from './resource_employee_document';
import type { BambooHrV1FileNode } from './resource_file';

export * from './resource_company_report';
export * from './resource_employee';
export * from './resource_employee_document';
export * from './resource_file';

export type BambooHrV1Node =
  | BambooHrV1CompanyReportNode
  | BambooHrV1EmployeeNode
  | BambooHrV1EmployeeDocumentNode
  | BambooHrV1FileNode
  ;