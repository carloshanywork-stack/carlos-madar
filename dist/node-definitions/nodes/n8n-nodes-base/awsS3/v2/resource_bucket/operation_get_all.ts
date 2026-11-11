/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=bucket, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many buckets */
export type AwsS3V2BucketGetAllParams = {
  resource: 'bucket';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
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
};

export type AwsS3V2BucketGetAllOutput = {
  BucketArn?: string;
  CreationDate?: string;
  Name?: string;
};

export type AwsS3V2BucketGetAllNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2BucketGetAllParams> & { credentials?: Credentials };
  output?: Items<AwsS3V2BucketGetAllOutput>;
};