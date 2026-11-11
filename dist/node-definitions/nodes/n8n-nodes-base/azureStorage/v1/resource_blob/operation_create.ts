/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=blob, operation=create
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Create a new blob or replace an existing one */
export type AzureStorageV1BlobCreateParams = {
  resource: 'blob';
  operation: 'create';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
/**
 * Container to create or replace a blob in
 * @searchListMethod getContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * The name of the new or existing blob
 */
    blobCreate: string | Expression<string>;
/**
 * From
 * @default binary
 */
    from?: 'binary' | 'url' | Expression<string>;
/**
 * The name of the input binary field containing the file to be written
 * @displayOptions.show { from: ["binary"] }
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * URL where to read of the blob contents from
 * @displayOptions.show { from: ["url"] }
 * @required when the displayOptions conditions above match
 */
    url?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** The tier to be set on the blob. For detailed information about block blob tiering, see &lt;a href="https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview"&gt;Hot, cool, and archive storage tiers&lt;/a&gt;.
     * @default Hot
     */
    accessTier?: 'Archive' | 'Cold' | 'Cool' | 'Hot' | Expression<string>;
    /** Specifies the type of blob to create: block, page, or append blob
     * @displayOptions.show { /from: ["binary"] }
     * @default BlockBlob
     */
    blobType?: 'BlockBlob' | 'PageBlob' | 'AppendBlob' | Expression<string>;
    /** Sets the blob's cache control value
     */
    cacheControl?: string | Expression<string>;
    /** CRC64 hash of the blob content to verify its integrity during transport
     */
    contentCrc64?: string | Expression<string>;
    /** Sets the blob's content encoding
     */
    contentEncoding?: string | Expression<string>;
    /** Sets the blob's content language
     */
    contentLanguage?: string | Expression<string>;
    /** Sets the blob's MD5 hash for integrity verification
     */
    contentMd5?: string | Expression<string>;
    /** Sets the blob's content type
     */
    contentType?: string | Expression<string>;
    /** If the value is set it will set blob system metadata. Max length-1024. Valid only when Hierarchical Namespace is enabled for the account.
     * @displayOptions.show { /from: ["binary"] }
     */
    encryptionContext?: string | Expression<string>;
    /** Indicates the encryption scope for encrypting the request contents
     */
    encryptionScope?: string | Expression<string>;
    /** Specifies the expiration date option for the request. This header is valid for accounts with hierarchical namespace enabled.
     * @default Absolute
     */
    expiryOption?: 'Absolute' | 'NeverExpire' | Expression<string>;
    /** Specifies the time when the blob is set to expire as an absolute time
     * @displayOptions.hide { /options.expiryOption: ["NeverExpire"] }
     */
    expiryTime?: string | Expression<string>;
    /** Filename
     */
    filename?: string | Expression<string>;
    /** Specifies the retention-until date to be set on the blob. This is the date until which the blob can be protected from being modified or deleted.
     * @displayOptions.show { /from: ["binary"] }
     */
    immutabilityPolicyUntilDate?: string | Expression<string>;
    /** Specifies the immutability policy mode to be set on the blob
     * @displayOptions.show { /from: ["binary"] }
     * @default unlocked
     */
    immutabilityPolicyMode?: string | Expression<string>;
    /** Required if the blob has an active lease
     */
    leaseId?: string | Expression<string>;
    /** Whether to set a legal hold on the blob
     * @displayOptions.show { /from: ["binary"] }
     * @default false
     */
    legalHold?: boolean | Expression<boolean>;
    /** A name-value pair to associate with the blob as metadata
     * @default []
     */
    metadata?: {
        /** Metadata
     */
    metadataValues?: Array<{
      /** Names must adhere to the naming rules for &lt;a href="https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/"&gt;C# identifiers&lt;/a&gt;
       */
      fieldName?: string | Expression<string>;
      /** Field Value
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
    /** Specifies the origin from which the request is issued. The presence of this header results in cross-origin resource sharing (CORS) headers on the response. For more information, see &lt;a href="https://learn.microsoft.com/en-us/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services"&gt;CORS support for the Azure Storage services&lt;/a&gt;.
     */
    origin?: string | Expression<string>;
    /** Sets the given tags on the blob
     * @default []
     */
    tags?: {
        /** Tag
     */
    tagValues?: Array<{
      /** Tag Name
       */
      tagName?: string | Expression<string>;
      /** Tag Value
       */
      tagValue?: string | Expression<string>;
    }>;
  };
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

export type AzureStorageV1BlobCreateOutput = {
  connection?: string;
  contentCrc64?: string;
  contentLength?: number;
  contentMd5?: string;
  date?: string;
  etag?: string;
  lastModified?: string;
  requestId?: string;
  requestServerEncrypted?: boolean;
  server?: string;
  version?: string;
};

export type AzureStorageV1BlobCreateNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1BlobCreateParams> & { credentials?: Credentials };
  output?: Items<AzureStorageV1BlobCreateOutput>;
};