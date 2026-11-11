/**
 * AWS Cognito Node - Version 1
 * Discriminator: resource=user, operation=create
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Create a new group */
export type AwsCognitoV1UserCreateParams = {
  resource: 'user';
  operation: 'create';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Select the user pool to retrieve
 * @searchListMethod searchUserPools
 * @default {"mode":"list","value":""}
 */
    userPool?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Depending on the user pool settings, this parameter requires the username, the email, or the phone number. No whitespace is allowed.
 */
    newUserName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Message Action
     * @default RESEND
     */
    messageAction?: 'RESEND' | 'SUPPRESS' | Expression<string>;
    /** Whether this parameter is used only if the phone_number_verified or email_verified attribute is set to true. Otherwise, it is ignored. If set to true, and the phone number or email address specified in the UserAttributes parameter already exists as an alias with a different user, the alias will be migrated. If set to false, an AliasExistsException error is thrown if the alias already exists.
     * @default false
     */
    forceAliasCreation?: boolean | Expression<boolean>;
    /** Attributes to update for the user
     * @default {"attributes":[]}
     */
    userAttributes?: {
        /** Attributes
     */
    attributes?: Array<{
      /** Attribute Type
       * @default standard
       */
      attributeType?: 'standard' | 'custom' | Expression<string>;
      /** Standard Attribute
       * @displayOptions.show { attributeType: ["standard"] }
       * @default address
       */
      standardName?: 'address' | 'birthdate' | 'email' | 'email_verified' | 'family_name' | 'gender' | 'given_name' | 'locale' | 'middle_name' | 'name' | 'nickname' | 'phone_number' | 'phone_number_verified' | 'preferred_username' | 'profilepicture' | 'updated_at' | 'sub' | 'website' | 'zoneinfo' | Expression<string>;
      /** The name of the custom attribute (must start with "custom:")
       * @displayOptions.show { attributeType: ["custom"] }
       */
      customName?: string | Expression<string>;
      /** The value of the attribute
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Specify how to send the welcome message
     * @default ["SMS"]
     */
    desiredDeliveryMediums?: Array<'SMS' | 'EMAIL'>;
    /** The user's temporary password that will be valid only once. If not set, Amazon Cognito will automatically generate one for you.
     */
    temporaryPasswordOptions?: string | Expression<string>;
  };
  requestOptions?: {
    /** Batching
     * @default {"batch":{}}
     */
    batching?: {
        /** Batching
     */
    batch?: {
      /** Input will be split in batches to throttle requests. -1 for disabled. 0 will be treated as 1.
       * @default 50
       */
      batchSize?: number | Expression<number>;
      /** Time (in milliseconds) between each batch of requests. 0 for disabled.
       * @default 1000
       */
      batchInterval?: number | Expression<number>;
    };
  };
    /** Whether to accept the response even if SSL certificate validation is not possible
     * @default false
     */
    allowUnauthorizedCerts?: boolean;
    /** HTTP proxy to use. If authentication is required it can be defined as follow: http://username:password@myproxy:3128
     */
    proxy?: string | Expression<string>;
    /** Time in ms to wait for the server to send response headers (and start the response body) before aborting the request
     * @default 10000
     */
    timeout?: number | Expression<number>;
  };
};

export type AwsCognitoV1UserCreateNode = {
  type: 'n8n-nodes-base.awsCognito';
  version: 1;
  config: NodeConfig<AwsCognitoV1UserCreateParams> & { credentials?: Credentials };
};