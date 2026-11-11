/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=file, operation=copy
 */


interface Credentials {
  aws: CredentialReference;
}

/** Copy a file */
export type AwsS3V1FileCopyParams = {
  resource: 'file';
  operation: 'copy';
/**
 * The name of the source bucket should start with (/) and key name of the source object, separated by a slash (/)
 */
    sourcePath: string | Expression<string>;
/**
 * The name of the destination bucket and key name of the destination object, separated by a slash (/)
 */
    destinationPath: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The canned ACL to apply to the object
     * @default private
     */
    acl?: 'authenticatedRead' | 'awsExecRead' | 'bucketOwnerFullControl' | 'bucketOwnerRead' | 'private' | 'publicRead' | 'publicReadWrite' | Expression<string>;
    /** Whether to give the grantee READ, READ_ACP, and WRITE_ACP permissions on the object
     * @default false
     */
    grantFullControl?: boolean | Expression<boolean>;
    /** Whether to allow grantee to read the object data and its metadata
     * @default false
     */
    grantRead?: boolean | Expression<boolean>;
    /** Whether to allow grantee to read the object ACL
     * @default false
     */
    grantReadAcp?: boolean | Expression<boolean>;
    /** Whether to allow grantee to write the ACL for the applicable object
     * @default false
     */
    grantWriteAcp?: boolean | Expression<boolean>;
    /** Whether a legal hold will be applied to this object
     * @default false
     */
    lockLegalHold?: boolean | Expression<boolean>;
    /** The Object Lock mode that you want to apply to this object
     */
    lockMode?: 'governance' | 'compliance' | Expression<string>;
    /** The date and time when you want this object's Object Lock to expire
     */
    lockRetainUntilDate?: string | Expression<string>;
    /** Specifies whether the metadata is copied from the source object or replaced with metadata provided in the request
     */
    metadataDirective?: 'copy' | 'replace' | Expression<string>;
    /** Whether the requester will pay for requests and data transfer. While Requester Pays is enabled, anonymous access to this bucket is disabled.
     * @default false
     */
    requesterPays?: boolean | Expression<boolean>;
    /** The server-side encryption algorithm used when storing this object in Amazon S3
     */
    serverSideEncryption?: 'AES256' | 'aws:kms' | Expression<string>;
    /** Specifies the AWS KMS Encryption Context to use for object encryption
     */
    serverSideEncryptionContext?: string | Expression<string>;
    /** If x-amz-server-side-encryption is present and has the value of aws:kms
     */
    encryptionAwsKmsKeyId?: string | Expression<string>;
    /** Specifies the algorithm to use to when encrypting the object (for example, AES256)
     */
    serversideEncryptionCustomerAlgorithm?: string | Expression<string>;
    /** Specifies the customer-provided encryption key for Amazon S3 to use in encrypting data
     */
    serversideEncryptionCustomerKey?: string | Expression<string>;
    /** Specifies the 128-bit MD5 digest of the encryption key according to RFC 1321
     */
    serversideEncryptionCustomerKeyMD5?: string | Expression<string>;
    /** Amazon S3 storage classes
     * @default standard
     */
    storageClass?: 'deepArchive' | 'glacier' | 'intelligentTiering' | 'onezoneIA' | 'standard' | 'standardIA' | Expression<string>;
    /** Specifies whether the metadata is copied from the source object or replaced with metadata provided in the request
     */
    taggingDirective?: 'copy' | 'replace' | Expression<string>;
  };
};

export type AwsS3V1FileCopyNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FileCopyParams> & { credentials?: Credentials };
};