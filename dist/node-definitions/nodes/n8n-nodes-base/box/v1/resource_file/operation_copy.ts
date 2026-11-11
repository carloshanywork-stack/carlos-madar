/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=copy
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Copy a file */
export type BoxV1FileCopyParams = {
  resource: 'file';
  operation: 'copy';
/**
 * File ID
 */
    fileId: string | Expression<string>;
/**
 * The ID of folder to copy the file to. If not defined will be copied to the root folder.
 */
    parentId?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
    /** An optional new name for the copied file
     */
    name?: string | Expression<string>;
    /** An optional ID of the specific file version to copy
     */
    version?: string | Expression<string>;
  };
};

export type BoxV1FileCopyOutput = {
  content_created_at?: string;
  content_modified_at?: string;
  created_at?: string;
  created_by?: {
    id?: string;
    login?: string;
    name?: string;
    type?: string;
  };
  description?: string;
  etag?: string;
  file_version?: {
    id?: string;
    sha1?: string;
    type?: string;
  };
  id?: string;
  item_status?: string;
  modified_at?: string;
  modified_by?: {
    id?: string;
    login?: string;
    name?: string;
    type?: string;
  };
  name?: string;
  owned_by?: {
    id?: string;
    login?: string;
    name?: string;
    type?: string;
  };
  parent?: {
    id?: string;
    name?: string;
    type?: string;
  };
  path_collection?: {
    entries?: Array<{
      id?: string;
      name?: string;
      type?: string;
    }>;
    total_count?: number;
  };
  purged_at?: null;
  sequence_id?: string;
  sha1?: string;
  shared_link?: null;
  size?: number;
  trashed_at?: null;
  type?: string;
};

export type BoxV1FileCopyNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileCopyParams> & { credentials?: Credentials };
  output?: Items<BoxV1FileCopyOutput>;
};