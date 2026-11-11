/**
 * AWS SES Node - Version 1
 * Discriminator: resource=customVerificationEmail, operation=get
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get the custom email verification template */
export type AwsSesV1CustomVerificationEmailGetParams = {
  resource: 'customVerificationEmail';
  operation: 'get';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The name of the custom verification email template
 */
    templateName?: string | Expression<string>;
};

export type AwsSesV1CustomVerificationEmailGetNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1CustomVerificationEmailGetParams> & { credentials?: Credentials };
};