/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=folder, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Delete a bucket */
export type AwsS3V2FolderDeleteParams = {
  resource: 'folder';
  operation: 'delete';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * Folder Key
 */
    folderKey: string | Expression<string>;
};

export type AwsS3V2FolderDeleteNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2FolderDeleteParams> & { credentials?: Credentials };
};