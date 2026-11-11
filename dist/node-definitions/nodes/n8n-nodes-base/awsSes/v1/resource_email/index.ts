/**
 * AWS SES - Email Resource
 * Re-exports all operation types for this resource.
 */

import type { AwsSesV1EmailSendNode } from './operation_send';
import type { AwsSesV1EmailSendTemplateNode } from './operation_send_template';

export * from './operation_send';
export * from './operation_send_template';

export type AwsSesV1EmailNode =
  | AwsSesV1EmailSendNode
  | AwsSesV1EmailSendTemplateNode
  ;