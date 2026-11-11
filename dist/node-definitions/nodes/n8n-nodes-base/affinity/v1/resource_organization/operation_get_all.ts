/**
 * Affinity Node - Version 1
 * Discriminator: resource=organization, operation=getAll
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get many lists */
export type AffinityV1OrganizationGetAllParams = {
  resource: 'organization';
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
/**
 * Options
 * @default {}
 */
    options?: {
    /** A string used to search all the organizations in your team’s address book. This could be an email address, a first name or a last name.
     */
    term?: string | Expression<string>;
    /** Whether interaction dates will be present on the returned resources
     * @default false
     */
    withInteractionDates?: boolean | Expression<boolean>;
  };
};

export type AffinityV1OrganizationGetAllOutput = {
  crunchbase_uuid?: null;
  domain?: string;
  domains?: Array<string>;
  global?: boolean;
  id?: number;
  name?: string;
};

export type AffinityV1OrganizationGetAllNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1OrganizationGetAllParams> & { credentials?: Credentials };
  output?: Items<AffinityV1OrganizationGetAllOutput>;
};