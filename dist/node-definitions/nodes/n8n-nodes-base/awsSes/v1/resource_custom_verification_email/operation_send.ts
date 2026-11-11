/**
 * AWS SES Node - Version 1
 * Discriminator: resource=customVerificationEmail, operation=send
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Add an email address to the list of identities */
export type AwsSesV1CustomVerificationEmailSendParams = {
  resource: 'customVerificationEmail';
  operation: 'send';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The email address to verify
 */
    email: string | Expression<string>;
/**
 * The name of the custom verification email template to use when sending the verification email
 */
    templateName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Name of a configuration set to use when sending the verification email
     */
    configurationSetName?: string | Expression<string>;
  };
};

export type AwsSesV1CustomVerificationEmailSendNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1CustomVerificationEmailSendParams> & { credentials?: Credentials };
};