/**
 * AWS IAM Node - Version 1
 * Discriminator: resource=group, operation=create
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Create a new user */
export type AwsIamV1GroupCreateParams = {
  resource: 'group';
  operation: 'create';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * The name of the new group to create
 */
    groupName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The path to the group, if it is not included, it defaults to a slash (/)
     * @default /
     */
    path?: string | Expression<string>;
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

export type AwsIamV1GroupCreateNode = {
  type: 'n8n-nodes-base.awsIam';
  version: 1;
  config: NodeConfig<AwsIamV1GroupCreateParams> & { credentials?: Credentials };
};