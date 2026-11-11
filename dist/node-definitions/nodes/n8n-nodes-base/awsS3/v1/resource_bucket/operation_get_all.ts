/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=bucket, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
}

/** Get many buckets */
export type AwsS3V1BucketGetAllParams = {
  resource: 'bucket';
  operation: 'getAll';
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

export type AwsS3V1BucketGetAllNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1BucketGetAllParams> & { credentials?: Credentials };
};