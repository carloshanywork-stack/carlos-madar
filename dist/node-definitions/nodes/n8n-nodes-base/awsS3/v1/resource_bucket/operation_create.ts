/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=bucket, operation=create
 */


interface Credentials {
  aws: CredentialReference;
}

/** Create a bucket */
export type AwsS3V1BucketCreateParams = {
  resource: 'bucket';
  operation: 'create';
/**
 * A succinct description of the nature, symptoms, cause, or effect of the bucket
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The canned ACL to apply to the bucket
     */
    acl?: 'authenticatedRead' | 'Private' | 'publicRead' | 'publicReadWrite' | Expression<string>;
    /** Whether you want S3 Object Lock to be enabled for the new bucket
     * @default false
     */
    bucketObjectLockEnabled?: boolean | Expression<boolean>;
    /** Whether to allow grantee the read, write, read ACP, and write ACP permissions on the bucket
     * @default false
     */
    grantFullControl?: boolean | Expression<boolean>;
    /** Whether to allow grantee to list the objects in the bucket
     * @default false
     */
    grantRead?: boolean | Expression<boolean>;
    /** Whether to allow grantee to read the bucket ACL
     * @default false
     */
    grantReadAcp?: boolean | Expression<boolean>;
    /** Whether to allow grantee to create, overwrite, and delete any object in the bucket
     * @default false
     */
    grantWrite?: boolean | Expression<boolean>;
    /** Whether to allow grantee to write the ACL for the applicable bucket
     * @default false
     */
    grantWriteAcp?: boolean | Expression<boolean>;
    /** Region you want to create the bucket in, by default the buckets are created on the region defined on the credentials
     */
    region?: string | Expression<string>;
  };
};

export type AwsS3V1BucketCreateNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1BucketCreateParams> & { credentials?: Credentials };
};