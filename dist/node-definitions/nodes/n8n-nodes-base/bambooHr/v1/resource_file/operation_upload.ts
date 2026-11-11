/**
 * BambooHR Node - Version 1
 * Discriminator: resource=file, operation=upload
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Upload an employee document */
export type BambooHrV1FileUploadParams = {
  resource: 'file';
  operation: 'upload';
/**
 * The name of the input field containing the binary file data to be uploaded. Supported file types: PNG, JPEG.
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getCompanyFileCategories
 */
    categoryId: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether this file is shared or not
     * @default true
     */
    share?: boolean | Expression<boolean>;
  };
};

export type BambooHrV1FileUploadNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1FileUploadParams> & { credentials?: Credentials };
};