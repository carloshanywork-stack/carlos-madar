/**
 * AWS S3 Node - Version 1
 * Discriminator: resource=folder, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
}

/** Get many buckets */
export type AwsS3V1FolderGetAllParams = {
  resource: 'folder';
  operation: 'getAll';
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
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
/**
 * Options
 * @default {}
 */
    options?: {
    /** The owner field is not present in listV2 by default, if you want to return owner field with each key in the result then set the fetch owner field to true
     * @default false
     */
    fetchOwner?: boolean | Expression<boolean>;
    /** Folder Key
     */
    folderKey?: string | Expression<string>;
  };
};

export type AwsS3V1FolderGetAllNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 1;
  config: NodeConfig<AwsS3V1FolderGetAllParams> & { credentials?: Credentials };
};