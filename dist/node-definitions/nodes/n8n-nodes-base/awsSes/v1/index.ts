/**
 * AWS SES Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { AwsSesV1CustomVerificationEmailNode } from './resource_custom_verification_email';
import type { AwsSesV1EmailNode } from './resource_email';
import type { AwsSesV1TemplateNode } from './resource_template';

export * from './resource_custom_verification_email';
export * from './resource_email';
export * from './resource_template';

export type AwsSesV1Node =
  | AwsSesV1CustomVerificationEmailNode
  | AwsSesV1EmailNode
  | AwsSesV1TemplateNode
  ;