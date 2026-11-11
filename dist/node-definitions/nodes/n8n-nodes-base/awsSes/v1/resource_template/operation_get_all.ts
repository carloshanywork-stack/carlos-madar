/**
 * AWS SES Node - Version 1
 * Discriminator: resource=template, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many of the existing custom verification email templates for your account */
export type AwsSesV1TemplateGetAllParams = {
  resource: 'template';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 20
 */
    limit?: number | Expression<number>;
};

export type AwsSesV1TemplateGetAllNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1TemplateGetAllParams> & { credentials?: Credentials };
};