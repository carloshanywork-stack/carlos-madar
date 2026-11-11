/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employee, operation=get
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Get an employee */
export type BambooHrV1EmployeeGetParams = {
  resource: 'employee';
  operation: 'get';
/**
 * Employee ID
 */
    employeeId: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Set of fields to get from employee data. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getEmployeeFields
     * @default ["all"]
     */
    fields?: string[];
  };
};

export type BambooHrV1EmployeeGetOutput = {
  canUploadPhoto?: boolean;
  displayName?: string;
  firstName?: string;
  hireDate?: string;
  id?: string;
  lastName?: string;
  photoUploaded?: boolean;
  photoUrl?: string;
};

export type BambooHrV1EmployeeGetNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeGetParams> & { credentials?: Credentials };
  output?: Items<BambooHrV1EmployeeGetOutput>;
};