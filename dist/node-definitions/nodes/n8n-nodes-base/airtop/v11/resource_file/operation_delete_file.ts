/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=file, operation=deleteFile
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Delete an uploaded file */
export type AirtopV11FileDeleteFileParams = {
  resource: 'file';
  operation: 'deleteFile';
/**
 * ID of the file to delete
 */
    fileId: string | Expression<string>;
};

export type AirtopV11FileDeleteFileNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11FileDeleteFileParams> & { credentials?: Credentials };
};