/**
 * AWS IAM Node - Version 1
 * Discriminator: resource=user, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Retrieve a list of users */
export type AwsIamV1UserGetAllParams = {
  resource: 'user';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.hide { returnAll: [true] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The path prefix for filtering the results
     * @default /
     */
    pathPrefix?: string | Expression<string>;
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

export type AwsIamV1UserGetAllOutput = {
  Arn?: string;
  CreateDate?: number;
  Path?: string;
  PermissionsBoundary?: null;
  Tags?: null;
  UserId?: string;
  UserName?: string;
};

export type AwsIamV1UserGetAllNode = {
  type: 'n8n-nodes-base.awsIam';
  version: 1;
  config: NodeConfig<AwsIamV1UserGetAllParams> & { credentials?: Credentials };
  output?: Items<AwsIamV1UserGetAllOutput>;
};