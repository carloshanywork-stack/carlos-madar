/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=folder, operation=create
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Create a bucket */
export type AwsS3V2FolderCreateParams = {
  resource: 'folder';
  operation: 'create';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * Folder Name
 */
    folderName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Parent folder you want to create the folder in
     */
    parentFolderKey?: string | Expression<string>;
    /** Whether the requester will pay for requests and data transfer. While Requester Pays is enabled, anonymous access to this bucket is disabled.
     * @default false
     */
    requesterPays?: boolean | Expression<boolean>;
    /** Amazon S3 storage classes
     * @default standard
     */
    storageClass?: 'deepArchive' | 'glacier' | 'intelligentTiering' | 'onezoneIA' | 'RecudedRedundancy' | 'standard' | 'standardIA' | Expression<string>;
  };
};

export type AwsS3V2FolderCreateOutput = {
  success?: boolean;
};

export type AwsS3V2FolderCreateNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2FolderCreateParams> & { credentials?: Credentials };
  output?: Items<AwsS3V2FolderCreateOutput>;
};