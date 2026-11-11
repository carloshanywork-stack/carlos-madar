/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employeeDocument, operation=update
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Update an employee */
export type BambooHrV1EmployeeDocumentUpdateParams = {
  resource: 'employeeDocument';
  operation: 'update';
/**
 * Employee ID
 */
    employeeId: string | Expression<string>;
/**
 * File ID
 */
    fileId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** ID of the new category of the file. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getEmployeeDocumentCategories
     */
    categoryId?: string | Expression<string>;
    /** New name of the file
     */
    name?: string | Expression<string>;
    /** Whether this file is shared or not
     * @default true
     */
    shareWithEmployee?: boolean | Expression<boolean>;
  };
};

export type BambooHrV1EmployeeDocumentUpdateNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeDocumentUpdateParams> & { credentials?: Credentials };
};