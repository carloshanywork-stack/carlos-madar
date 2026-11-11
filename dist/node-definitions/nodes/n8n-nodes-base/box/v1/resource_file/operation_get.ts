/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=get
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Get a file */
export type BoxV1FileGetParams = {
  resource: 'file';
  operation: 'get';
/**
 * Field ID
 */
    fileId?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
  };
};

export type BoxV1FileGetOutput = {
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
  size?: number;
  trashed_at?: null;
  type?: string;
};

export type BoxV1FileGetNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileGetParams> & { credentials?: Credentials };
  output?: Items<BoxV1FileGetOutput>;
};