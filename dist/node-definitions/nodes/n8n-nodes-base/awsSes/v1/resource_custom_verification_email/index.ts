/**
 * AWS SES - CustomVerificationEmail Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsSesV1CustomVerificationEmailCreateNode } from './operation_create';
import type { AwsSesV1CustomVerificationEmailDeleteNode } from './operation_delete';
import type { AwsSesV1CustomVerificationEmailGetNode } from './operation_get';
import type { AwsSesV1CustomVerificationEmailGetAllNode } from './operation_get_all';
import type { AwsSesV1CustomVerificationEmailSendNode } from './operation_send';
import type { AwsSesV1CustomVerificationEmailUpdateNode } from './operation_update';

export * from './operation_create';
export * from './operation_delete';
export * from './operation_get';
export * from './operation_get_all';
export * from './operation_send';
export * from './operation_update';

export type AwsSesV1CustomVerificationEmailNode =
  | AwsSesV1CustomVerificationEmailCreateNode
  | AwsSesV1CustomVerificationEmailDeleteNode
  | AwsSesV1CustomVerificationEmailGetNode
  | AwsSesV1CustomVerificationEmailGetAllNode
  | AwsSesV1CustomVerificationEmailSendNode
  | AwsSesV1CustomVerificationEmailUpdateNode
  ;