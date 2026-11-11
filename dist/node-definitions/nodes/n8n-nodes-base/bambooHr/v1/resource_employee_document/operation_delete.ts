/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employeeDocument, operation=delete
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Delete an employee document */
export type BambooHrV1EmployeeDocumentDeleteParams = {
  resource: 'employeeDocument';
  operation: 'delete';
/**
 * ID of the employee
 */
    employeeId: string | Expression<string>;
/**
 * ID of the employee file
 */
    fileId: string | Expression<string>;
};

export type BambooHrV1EmployeeDocumentDeleteNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeDocumentDeleteParams> & { credentials?: Credentials };
};