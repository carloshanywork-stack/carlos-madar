/**
 * AWS SES Node - Version 1
 * Discriminator: resource=email, operation=sendTemplate
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

export type AwsSesV1EmailSendTemplateParams = {
  resource: 'email';
  operation: 'sendTemplate';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The ARN of the template to use when sending this email. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTemplates
 */
    templateName?: string | Expression<string>;
/**
 * Email address of the sender
 */
    fromEmail: string | Expression<string>;
/**
 * Email addresses of the recipients
 * @default []
 */
    toAddresses?: Array<string | Expression<string>>;
/**
 * Template Data
 * @default {}
 */
    templateDataUi?: {
        /** Data
     */
    templateDataValues?: Array<{
      /** Key
       */
      key?: string | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Bcc Recipients of the email
     * @default []
     */
    bccAddresses?: Array<string | Expression<string>>;
    /** Cc recipients of the email
     * @default []
     */
    ccAddresses?: Array<string | Expression<string>>;
    /** Name of the configuration set to use when you send an email using send
     */
    configurationSetName?: string | Expression<string>;
    /** Reply-to email address(es) for the message
     * @default []
     */
    replyToAddresses?: Array<string | Expression<string>>;
    /** Email address that bounces and complaints will be forwarded to when feedback forwarding is enabled
     */
    returnPath?: string | Expression<string>;
    /** This parameter is used only for sending authorization
     */
    returnPathArn?: string | Expression<string>;
    /** This parameter is used only for sending authorization
     */
    sourceArn?: string | Expression<string>;
  };
};

export type AwsSesV1EmailSendTemplateOutput = {
  $?: {
    xmlns?: string;
  };
  ResponseMetadata?: {
    RequestId?: string;
  };
  SendTemplatedEmailResult?: {
    MessageId?: string;
  };
};

export type AwsSesV1EmailSendTemplateNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1EmailSendTemplateParams> & { credentials?: Credentials };
  output?: Items<AwsSesV1EmailSendTemplateOutput>;
};