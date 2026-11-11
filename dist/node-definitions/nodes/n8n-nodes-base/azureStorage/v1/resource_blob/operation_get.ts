/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=blob, operation=get
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Retrieve data for a specific blob */
export type AzureStorageV1BlobGetParams = {
  resource: 'blob';
  operation: 'get';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
/**
 * Container to get a blob from
 * @searchListMethod getContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Blob to get
 * @searchListMethod getBlobs
 * @default {"mode":"list","value":""}
 */
    blob?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Options
 * @default {}
 */
    options?: {
    /** If this header is specified, the operation is performed only if both of the following conditions are met: &lt;ul&gt;&lt;li&gt;The blob's lease is currently active.&lt;/li&gt;&lt;li&gt;The lease ID that's specified in the request matches the lease ID of the blob.&lt;/li&gt;&lt;/ul&gt;
     */
    leaseId?: string | Expression<string>;
    /** Specifies the origin from which the request is issued. The presence of this header results in cross-origin resource sharing (CORS) headers on the response.
     */
    origin?: string | Expression<string>;
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

export type AzureStorageV1BlobGetOutput = {
  name?: string;
  properties?: {
    accessTier?: string;
    accessTierInferred?: string;
    blobType?: string;
    contentDisposition?: string;
    contentLength?: number;
    contentMd5?: string;
    contentType?: string;
    creationTime?: string;
    etag?: string;
    group?: string;
    lastModified?: string;
    leaseState?: string;
    leaseStatus?: string;
    owner?: string;
    permissions?: string;
    resourceType?: string;
    serverEncrypted?: boolean;
  };
};

export type AzureStorageV1BlobGetNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1BlobGetParams> & { credentials?: Credentials };
  output?: Items<AzureStorageV1BlobGetOutput>;
};