/**
 * AWS SES Node - Version 1
 * Discriminator: resource=template, operation=get
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get the custom email verification template */
export type AwsSesV1TemplateGetParams = {
  resource: 'template';
  operation: 'get';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The name of the template
 */
    templateName: string | Expression<string>;
};

export type AwsSesV1TemplateGetNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1TemplateGetParams> & { credentials?: Credentials };
};