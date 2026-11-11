/**
 * BambooHR Node - Version 1
 * Discriminator: resource=file, operation=delete
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Delete an employee document */
export type BambooHrV1FileDeleteParams = {
  resource: 'file';
  operation: 'delete';
/**
 * ID of the file
 */
    fileId: string | Expression<string>;
};

export type BambooHrV1FileDeleteNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1FileDeleteParams> & { credentials?: Credentials };
};