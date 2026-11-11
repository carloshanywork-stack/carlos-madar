/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=container, operation=getAll
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Retrieve a list of blobs */
export type AzureStorageV1ContainerGetAllParams = {
  resource: 'container';
  operation: 'getAll';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
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
 * Options
 * @default {}
 */
    options?: {
    /** The fields to add to the output
     * @default []
     */
    fields?: Array<'metadata' | 'deleted' | 'system'>;
    /** Filters the results to return only containers with a name that begins with the specified prefix
     */
    filter?: string | Expression<string>;
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

export type AzureStorageV1ContainerGetAllOutput = {
  name?: string;
  properties?: {
    defaultEncryptionScope?: string;
    denyEncryptionScopeOverride?: string;
    etag?: string;
    hasImmutabilityPolicy?: boolean;
    hasLegalHold?: boolean;
    immutableStorageWithVersioningEnabled?: string;
    lastModified?: string;
    leaseState?: string;
    leaseStatus?: string;
  };
};

export type AzureStorageV1ContainerGetAllNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1ContainerGetAllParams> & { credentials?: Credentials };
  output?: Items<AzureStorageV1ContainerGetAllOutput>;
};