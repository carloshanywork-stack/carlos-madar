/**
 * AWS S3 Node - Version 2
 * Discriminator: resource=folder, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many buckets */
export type AwsS3V2FolderGetAllParams = {
  resource: 'folder';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
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

export type AwsS3V2FolderGetAllOutput = {
  ChecksumAlgorithm?: string;
  ChecksumType?: string;
  ETag?: string;
  Key?: string;
  LastModified?: string;
  Size?: string;
  StorageClass?: string;
};

export type AwsS3V2FolderGetAllNode = {
  type: 'n8n-nodes-base.awsS3';
  version: 2;
  config: NodeConfig<AwsS3V2FolderGetAllParams> & { credentials?: Credentials };
  output?: Items<AwsS3V2FolderGetAllOutput>;
};