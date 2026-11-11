/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=file, operation=download
 */


interface Credentials {
  aws: CredentialReference;
}

/** Download a file */
export type AwsS3V1FileDownloadParams = {
  resource: 'file';
  operation: 'download';
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * File Key
 */
    fileKey: string | Expression<string>;
/**
 * Put Output File in Field
 * @hint The name of the output binary field to put the file in
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
};

export type AwsS3V1FileDownloadNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FileDownloadParams> & { credentials?: Credentials };
};