/**
 * Clearbit Node - Version 1
 * Discriminator: resource=company, operation=enrich
 */


interface Credentials {
  clearbitApi: CredentialReference;
}

/** The Company API allows you to look up a company by their domain */
export type ClearbitV1CompanyEnrichParams = {
  resource: 'company';
  operation: 'enrich';
/**
 * The domain to look up
 */
    domain: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The name of the company
     */
    companyName?: string | Expression<string>;
    /** The Facebook URL for the company
     */
    facebook?: string | Expression<string>;
    /** The LinkedIn URL for the company
     */
    linkedin?: string | Expression<string>;
    /** The Twitter handle for the company
     */
    twitter?: string | Expression<string>;
  };
};

export type ClearbitV1CompanyEnrichNode = {
  type: 'n8n-nodes-base.clearbit';
  version: 1;
  config: NodeConfig<ClearbitV1CompanyEnrichParams> & { credentials?: Credentials };
};