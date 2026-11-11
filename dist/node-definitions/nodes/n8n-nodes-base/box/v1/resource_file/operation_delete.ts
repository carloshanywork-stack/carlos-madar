/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=delete
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Delete a file */
export type BoxV1FileDeleteParams = {
  resource: 'file';
  operation: 'delete';
/**
 * Field ID
 */
    fileId?: string | Expression<string>;
};

export type BoxV1FileDeleteOutput = {
  success?: boolean;
};

export type BoxV1FileDeleteNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileDeleteParams> & { credentials?: Credentials };
  output?: Items<BoxV1FileDeleteOutput>;
};