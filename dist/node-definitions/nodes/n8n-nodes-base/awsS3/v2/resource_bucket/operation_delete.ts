/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=bucket, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Delete a bucket */
export type AwsS3V2BucketDeleteParams = {
  resource: 'bucket';
  operation: 'delete';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Name of the AWS S3 bucket to delete
 */
    name: string | Expression<string>;
};

export type AwsS3V2BucketDeleteNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2BucketDeleteParams> & { credentials?: Credentials };
};