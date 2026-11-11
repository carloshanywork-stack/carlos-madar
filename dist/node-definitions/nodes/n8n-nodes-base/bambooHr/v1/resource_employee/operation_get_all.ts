/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employee, operation=getAll
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Get many employees */
export type BambooHrV1EmployeeGetAllParams = {
  resource: 'employee';
  operation: 'getAll';
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
};

export type BambooHrV1EmployeeGetAllOutput = {
  canUploadPhoto?: number;
  department?: string;
  displayName?: string;
  firstName?: string;
  id?: string;
  jobTitle?: string;
  lastName?: string;
  location?: string;
  photoUploaded?: boolean;
  photoUrl?: string;
  pronouns?: null;
  supervisor?: string;
  workEmail?: string;
};

export type BambooHrV1EmployeeGetAllNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeGetAllParams> & { credentials?: Credentials };
  output?: Items<BambooHrV1EmployeeGetAllOutput>;
};