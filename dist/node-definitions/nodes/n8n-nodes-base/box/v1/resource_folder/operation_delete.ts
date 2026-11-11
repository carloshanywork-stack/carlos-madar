/**
 * Box Node - Version 1
 * Discriminator: resource=folder, operation=delete
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Delete a file */
export type BoxV1FolderDeleteParams = {
  resource: 'folder';
  operation: 'delete';
/**
 * Folder ID
 */
    folderId?: string | Expression<string>;
/**
 * Whether to delete a folder that is not empty by recursively deleting the folder and all of its content
 * @default false
 */
    recursive?: boolean | Expression<boolean>;
};

export type BoxV1FolderDeleteNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FolderDeleteParams> & { credentials?: Credentials };
};