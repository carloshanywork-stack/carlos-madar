/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=folder, operation=create
 */


interface Credentials {
  aws: CredentialReference;
}

/** Create a bucket */
export type AwsS3V1FolderCreateParams = {
  resource: 'folder';
  operation: 'create';
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

export type AwsS3V1FolderCreateNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FolderCreateParams> & { credentials?: Credentials };
};