/**
 * Box Node - Version 1
 * Discriminator: resource=folder, operation=create
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Create a folder */
export type BoxV1FolderCreateParams = {
  resource: 'folder';
  operation: 'create';
/**
 * Folder's name
 */
    name: string | Expression<string>;
/**
 * ID of the folder you want to create the new folder in. if not defined it will be created on the root folder.
 */
    parentId?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** ID of the folder you want to create the new folder in
     */
    access?: 'collaborators' | 'open' | Expression<string>;
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
  };
};

export type BoxV1FolderCreateOutput = {
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
  folder_upload_email?: null;
  id?: string;
  item_collection?: {
    limit?: number;
    offset?: number;
    order?: Array<{
      by?: string;
      direction?: string;
    }>;
    total_count?: number;
  };
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
  shared_link?: null;
  size?: number;
  trashed_at?: null;
  type?: string;
};

export type BoxV1FolderCreateNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FolderCreateParams> & { credentials?: Credentials };
  output?: Items<BoxV1FolderCreateOutput>;
};