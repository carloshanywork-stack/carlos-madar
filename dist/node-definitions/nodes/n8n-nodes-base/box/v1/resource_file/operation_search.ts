/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=search
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Search files */
export type BoxV1FileSearchParams = {
  resource: 'file';
  operation: 'search';
/**
 * The string to search for. This query is matched against item names, descriptions, text content of files, and various other fields of the different item types.
 */
    query?: string | Expression<string>;
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
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Limits search results to items with the given content types. Content types are defined as a comma-separated lists of Box recognized content types.
     */
    contet_types?: string | Expression<string>;
    /** Created At Range
     * @default {}
     */
    createdRangeUi?: {
        /** Range
     */
    createdRangeValuesUi?: {
      /** From
       */
      from?: string | Expression<string>;
      /** To
       */
      to?: string | Expression<string>;
    };
  };
    /** Defines the direction in which search results are ordered. Default value is DESC.
     */
    direction?: 'ASC' | 'DESC' | Expression<string>;
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
    /** Limits search results to a comma-separated list of file extensions
     */
    file_extensions?: string | Expression<string>;
    /** Limits search results to items within the given list of folders. Folders are defined as a comma-separated lists of folder IDs.
     */
    ancestor_folder_ids?: string | Expression<string>;
    /** Limits search results to a user scope
     */
    scope?: 'user_content' | 'enterprise_content' | Expression<string>;
    /** Limits search results to items within a given file size range. File size ranges are defined as comma-separated byte sizes.
     */
    size_range?: string | Expression<string>;
    /** Returns the results ordered in descending order by date at which the item was last modified
     * @default relevance
     */
    sort?: 'relevance' | 'modified_at' | Expression<string>;
    /** Controls if search results include the trash
     * @default non_trashed_only
     */
    trash_content?: 'non_trashed_only' | 'trashed_only' | Expression<string>;
    /** Update At Range
     * @default {}
     */
    updatedRangeUi?: {
        /** Range
     */
    updatedRangeValuesUi?: {
      /** From
       */
      from?: string | Expression<string>;
      /** To
       */
      to?: string | Expression<string>;
    };
  };
    /** Limits search results to items owned by the given list of owners. Owners are defined as a comma-separated list of user IDs.
     */
    owner_user_ids?: string | Expression<string>;
  };
};

export type BoxV1FileSearchOutput = {
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
  folder_upload_email?: null;
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
    etag?: string;
    id?: string;
    name?: string;
    sequence_id?: string;
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

export type BoxV1FileSearchNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileSearchParams> & { credentials?: Credentials };
  output?: Items<BoxV1FileSearchOutput>;
};