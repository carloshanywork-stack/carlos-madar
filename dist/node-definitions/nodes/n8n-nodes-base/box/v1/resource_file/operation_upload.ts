/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=upload
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Upload a file */
export type BoxV1FileUploadParams = {
  resource: 'file';
  operation: 'upload';
/**
 * The name the file should be saved as
 */
    fileName?: string | Expression<string>;
/**
 * Whether the data to upload should be taken from binary field
 * @default false
 */
    binaryData?: boolean | Expression<boolean>;
/**
 * The text content of the file
 * @displayOptions.show { binaryData: [false] }
 * @required when the displayOptions conditions above match
 */
    fileContent?: string | Expression<string>;
/**
 * Input Binary Field
 * @hint The name of the input binary field containing the file to be uploaded
 * @displayOptions.show { binaryData: [true] }
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * ID of the parent folder that will contain the file. If not it will be uploaded to the root folder.
 */
    parentId?: string | Expression<string>;
};

export type BoxV1FileUploadOutput = {
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

export type BoxV1FileUploadNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileUploadParams> & { credentials?: Credentials };
  output?: Items<BoxV1FileUploadOutput>;
};