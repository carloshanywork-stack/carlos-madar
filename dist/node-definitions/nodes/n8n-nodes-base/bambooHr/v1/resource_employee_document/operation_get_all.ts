/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employeeDocument, operation=getAll
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Get many employees */
export type BambooHrV1EmployeeDocumentGetAllParams = {
  resource: 'employeeDocument';
  operation: 'getAll';
/**
 * Employee ID
 */
    employeeId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 5
 */
    limit?: number | Expression<number>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simplifyOutput?: boolean | Expression<boolean>;
};

export type BambooHrV1EmployeeDocumentGetAllNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeDocumentGetAllParams> & { credentials?: Credentials };
};