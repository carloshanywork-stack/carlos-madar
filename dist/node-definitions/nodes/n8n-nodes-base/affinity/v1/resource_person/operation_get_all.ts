/**
 * Affinity Node - Version 1
 * Discriminator: resource=person, operation=getAll
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get many lists */
export type AffinityV1PersonGetAllParams = {
  resource: 'person';
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
    /** A string used to search all the persons in your team’s address book. This could be an email address, a first name or a last name.
     */
    term?: string | Expression<string>;
    /** Whether interaction dates will be present on the returned resources
     * @default false
     */
    withInteractionDates?: boolean | Expression<boolean>;
  };
};

export type AffinityV1PersonGetAllOutput = {
  emails?: Array<string>;
  first_name?: string;
  id?: number;
  last_name?: string;
  primary_email?: string;
  type?: number;
};

export type AffinityV1PersonGetAllNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1PersonGetAllParams> & { credentials?: Credentials };
  output?: Items<AffinityV1PersonGetAllOutput>;
};