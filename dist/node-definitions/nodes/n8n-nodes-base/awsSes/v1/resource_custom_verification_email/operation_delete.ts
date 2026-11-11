/**
 * AWS SES Node - Version 1
 * Discriminator: resource=customVerificationEmail, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Delete an existing custom verification email template */
export type AwsSesV1CustomVerificationEmailDeleteParams = {
  resource: 'customVerificationEmail';
  operation: 'delete';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The name of the custom verification email template
 */
    templateName?: string | Expression<string>;
};

export type AwsSesV1CustomVerificationEmailDeleteNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1CustomVerificationEmailDeleteParams> & { credentials?: Credentials };
};