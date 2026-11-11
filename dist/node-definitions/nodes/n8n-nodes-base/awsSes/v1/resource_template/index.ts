/**
 * AWS SES - Template Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsSesV1TemplateCreateNode } from './operation_create';
import type { AwsSesV1TemplateDeleteNode } from './operation_delete';
import type { AwsSesV1TemplateGetNode } from './operation_get';
import type { AwsSesV1TemplateGetAllNode } from './operation_get_all';
import type { AwsSesV1TemplateUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_update';

export type AwsSesV1TemplateNode =
  | AwsSesV1TemplateCreateNode
  | AwsSesV1TemplateDeleteNode
  | AwsSesV1TemplateGetNode
  | AwsSesV1TemplateGetAllNode
  | AwsSesV1TemplateUpdateNode
  ;