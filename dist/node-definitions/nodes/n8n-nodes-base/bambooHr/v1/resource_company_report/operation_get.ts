/**
 * BambooHR Node - Version 1
 * Discriminator: resource=companyReport, operation=get
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Get an employee */
export type BambooHrV1CompanyReportGetParams = {
  resource: 'companyReport';
  operation: 'get';
/**
 * ID of the report. You can get the report number by hovering over the report name on the reports page and grabbing the ID.
 */
    reportId: string | Expression<string>;
/**
 * The output format for the report
 * @default JSON
 */
    format?: 'CSV' | 'JSON' | 'PDF' | 'XLS' | 'XML' | Expression<string>;
/**
 * The name of the output field to put the binary file data in
 * @displayOptions.hide { format: ["JSON"] }
 * @default data
 */
    output?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether to apply the standard duplicate field filtering or not
     * @default true
     */
    fd?: boolean | Expression<boolean>;
    /** Whether to hide future dated values from the history table fields or not
     * @default true
     */
    onlyCurrent?: boolean | Expression<boolean>;
  };
};

export type BambooHrV1CompanyReportGetOutput = {
  employees?: Array<{
    fullName1?: string;
    fullName2?: string;
    hireDate?: string;
    id?: string;
    lastChanged?: string;
    payRate?: string;
    status?: string;
    terminationDate?: string;
  }>;
  fields?: Array<{
    name?: string;
    type?: string;
  }>;
  title?: string;
};

export type BambooHrV1CompanyReportGetNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1CompanyReportGetParams> & { credentials?: Credentials };
  output?: Items<BambooHrV1CompanyReportGetOutput>;
};