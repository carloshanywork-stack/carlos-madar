/**
 * AWS Cognito Node - Version 1
 * Discriminator: resource=group, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Retrieve a list of groups */
export type AwsCognitoV1GroupGetAllParams = {
  resource: 'group';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Select the user pool to use
 * @searchListMethod searchUserPools
 * @default {"mode":"list","value":""}
 */
    userPool?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Whether to include a list of users in the group
 * @default false
 */
    includeUsers?: boolean | Expression<boolean>;
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

export type AwsCognitoV1GroupGetAllNode = {
  type: 'n8n-nodes-base.awsCognito';
  version: 1;
  config: NodeConfig<AwsCognitoV1GroupGetAllParams> & { credentials?: Credentials };
};