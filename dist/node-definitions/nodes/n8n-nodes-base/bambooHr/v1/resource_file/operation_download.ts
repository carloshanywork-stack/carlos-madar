/**
 * BambooHR Node - Version 1
 * Discriminator: resource=file, operation=download
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Download an employee document */
export type BambooHrV1FileDownloadParams = {
  resource: 'file';
  operation: 'download';
/**
 * ID of the file
 */
    fileId: string | Expression<string>;
/**
 * The name of the output field to put the binary file data in
 * @default data
 */
    output?: string | Expression<string>;
};

export type BambooHrV1FileDownloadNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1FileDownloadParams> & { credentials?: Credentials };
};