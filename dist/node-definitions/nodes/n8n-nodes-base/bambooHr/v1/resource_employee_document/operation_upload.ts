/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employeeDocument, operation=upload
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Upload an employee document */
export type BambooHrV1EmployeeDocumentUploadParams = {
  resource: 'employeeDocument';
  operation: 'upload';
/**
 * ID of the employee
 */
    employeeId: string | Expression<string>;
/**
 * Employee Document Category ID
 */
    categoryId: string | Expression<string>;
/**
 * The name of the input field containing the binary file data to be uploaded. Supported file types: PNG, JPEG.
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
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

export type BambooHrV1EmployeeDocumentUploadNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeDocumentUploadParams> & { credentials?: Credentials };
};