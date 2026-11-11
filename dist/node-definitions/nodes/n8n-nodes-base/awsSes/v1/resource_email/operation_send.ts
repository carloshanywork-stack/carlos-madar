/**
 * AWS SES Node - Version 1
 * Discriminator: resource=email, operation=send
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Add an email address to the list of identities */
export type AwsSesV1EmailSendParams = {
  resource: 'email';
  operation: 'send';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Whether body is HTML or simple text
 * @default false
 */
    isBodyHtml?: boolean | Expression<boolean>;
/**
 * Subject
 */
    subject: string | Expression<string>;
/**
 * The message to be sent
 */
    body: string | Expression<string>;
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

export type AwsSesV1EmailSendOutput = {
  SendEmailResponse?: {
    $?: {
      xmlns?: string;
    };
    ResponseMetadata?: {
      RequestId?: string;
    };
    SendEmailResult?: {
      MessageId?: string;
    };
  };
};

export type AwsSesV1EmailSendNode = {
  type: 'n8n-nodes-base.awsSes';
  version: 1;
  config: NodeConfig<AwsSesV1EmailSendParams> & { credentials?: Credentials };
  output?: Items<AwsSesV1EmailSendOutput>;
};