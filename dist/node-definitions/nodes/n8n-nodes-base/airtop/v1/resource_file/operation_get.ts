/**
 * Airtop Node - Version 1
 * Discriminator: resource=file, operation=get
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Get a details of an uploaded file */
export type AirtopV1FileGetParams = {
  resource: 'file';
  operation: 'get';
/**
 * ID of the file to retrieve
 */
    fileId: string | Expression<string>;
/**
 * Whether to output the file in binary format if the file is ready for download
 * @default false
 */
    outputBinaryFile?: boolean | Expression<boolean>;
};

export type AirtopV1FileGetNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1FileGetParams> & { credentials?: Credentials };
};