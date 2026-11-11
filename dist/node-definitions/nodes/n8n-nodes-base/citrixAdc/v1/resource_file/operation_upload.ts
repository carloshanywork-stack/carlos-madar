/**
 * Netscaler ADC Node - Version 1
 * Discriminator: resource=file, operation=upload
 */


interface Credentials {
  citrixAdcApi: CredentialReference;
}

export type CitrixAdcV1FileUploadParams = {
  resource: 'file';
  operation: 'upload';
/**
 * File Location
 * @default /nsconfig/ssl/
 */
    fileLocation?: string | Expression<string>;
/**
 * The name of the incoming field containing the binary file data to be processed
 * @default data
 */
    binaryProperty?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Name of the file. It should not include filepath.
     */
    fileName?: string | Expression<string>;
  };
};

export type CitrixAdcV1FileUploadNode = {
  type: 'n8n-nodes-base.citrixAdc';
  version: 1;
  config: NodeConfig<CitrixAdcV1FileUploadParams> & { credentials?: Credentials };
};