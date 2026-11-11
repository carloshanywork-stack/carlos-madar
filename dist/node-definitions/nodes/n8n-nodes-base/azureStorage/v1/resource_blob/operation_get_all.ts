/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=blob, operation=getAll
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Retrieve a list of blobs */
export type AzureStorageV1BlobGetAllParams = {
  resource: 'blob';
  operation: 'getAll';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
/**
 * Container to get blobs from
 * @searchListMethod getContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
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
    fields?: Array<'copy' | 'deleted' | 'deletedwithversions' | 'immutabilitypolicy' | 'legalhold' | 'metadata' | 'permissions' | 'snapshots' | 'tags' | 'uncommittedblobs' | 'versions'>;
    /** The type of datasets to be returned
     * @default []
     */
    filter?: Array<'deleted' | 'files' | 'directories'>;
    /** Whether to return a simplified version of the response instead of the raw data
     * @default true
     */
    simplify?: boolean | Expression<boolean>;
    /** Whether the user identity values that are returned in the response will be transformed from Microsoft Entra object IDs to User Principal Names. If the value is false, they're returned as Microsoft Entra object IDs. Valid for accounts with hierarchical namespace enabled.
     * @default false
     */
    upn?: boolean | Expression<boolean>;
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

export type AzureStorageV1BlobGetAllOutput = {
  name?: string;
  properties?: {
    blobType?: string;
    contentLength?: number;
    contentMD5?: string;
    contentType?: string;
    creationTime?: string;
    etag?: string;
    lastModified?: string;
    leaseState?: string;
    leaseStatus?: string;
    serverEncrypted?: boolean;
  };
};

export type AzureStorageV1BlobGetAllNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1BlobGetAllParams> & { credentials?: Credentials };
  output?: Items<AzureStorageV1BlobGetAllOutput>;
};