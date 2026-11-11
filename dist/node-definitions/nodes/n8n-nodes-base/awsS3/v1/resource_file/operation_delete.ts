/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=file, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
}

/** Delete a bucket */
export type AwsS3V1FileDeleteParams = {
  resource: 'file';
  operation: 'delete';
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * File Key
 */
    fileKey: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Version ID
     */
    versionId?: string | Expression<string>;
  };
};

export type AwsS3V1FileDeleteNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FileDeleteParams> & { credentials?: Credentials };
};