/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=bucket, operation=search
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Search within a bucket */
export type AwsS3V2BucketSearchParams = {
  resource: 'bucket';
  operation: 'search';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** A delimiter is a character you use to group keys
     */
    delimiter?: string | Expression<string>;
    /** Whether to return common prefixes (grouped keys) instead of object contents. Only works when a Delimiter is set.
     * @default false
     */
    includeCommonPrefixes?: boolean | Expression<boolean>;
    /** Encoding type used by Amazon S3 to encode object keys in the response
     */
    encodingType?: 'url' | Expression<string>;
    /** The owner field is not present in listV2 by default, if you want to return owner field with each key in the result then set the fetch owner field to true
     * @default false
     */
    fetchOwner?: boolean | Expression<boolean>;
    /** Limits the response to keys that begin with the specified prefix
     */
    prefix?: string | Expression<string>;
    /** Whether the requester will pay for requests and data transfer. While Requester Pays is enabled, anonymous access to this bucket is disabled.
     * @default false
     */
    requesterPays?: boolean | Expression<boolean>;
    /** StartAfter is where you want Amazon S3 to start listing from. Amazon S3 starts listing after this specified key.
     */
    startAfter?: string | Expression<string>;
  };
};

export type AwsS3V2BucketSearchOutput = {
  ChecksumAlgorithm?: string;
  ChecksumType?: string;
  ETag?: string;
  Key?: string;
  LastModified?: string;
  Size?: string;
  StorageClass?: string;
};

export type AwsS3V2BucketSearchNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2BucketSearchParams> & { credentials?: Credentials };
  output?: Items<AwsS3V2BucketSearchOutput>;
};