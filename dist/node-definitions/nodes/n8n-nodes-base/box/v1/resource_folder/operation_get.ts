/**
 * Box Node - Version 1
 * Discriminator: resource=folder, operation=get
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Get a file */
export type BoxV1FolderGetParams = {
  resource: 'folder';
  operation: 'get';
/**
 * Folder ID
 */
    folderId?: string | Expression<string>;
};

export type BoxV1FolderGetOutput = {
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
  id?: string;
  item_collection?: {
    entries?: Array<{
      etag?: string;
      file_version?: {
        id?: string;
        sha1?: string;
        type?: string;
      };
      id?: string;
      name?: string;
      sequence_id?: string;
      sha1?: string;
      type?: string;
    }>;
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
  size?: number;
  trashed_at?: null;
  type?: string;
};

export type BoxV1FolderGetNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FolderGetParams> & { credentials?: Credentials };
  output?: Items<BoxV1FolderGetOutput>;
};