/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=folder, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
}

/** Delete a bucket */
export type AwsS3V1FolderDeleteParams = {
  resource: 'folder';
  operation: 'delete';
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * Folder Key
 */
    folderKey: string | Expression<string>;
};

export type AwsS3V1FolderDeleteNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FolderDeleteParams> & { credentials?: Credentials };
};