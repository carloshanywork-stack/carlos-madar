/**
 * Affinity Node - Version 1
 * Discriminator: resource=person, operation=get
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get a list */
export type AffinityV1PersonGetParams = {
  resource: 'person';
  operation: 'get';
/**
 * Unique identifier for the person
 */
    personId: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether interaction dates will be present on the returned resources
     * @default false
     */
    withInteractionDates?: boolean | Expression<boolean>;
  };
};

export type AffinityV1PersonGetOutput = {
  emails?: Array<string>;
  first_name?: string;
  id?: number;
  last_name?: string;
  list_entries?: Array<{
    created_at?: string;
    creator_id?: number;
    entity_id?: number;
    entity_type?: number;
    id?: number;
    list_id?: number;
  }>;
  organization_ids?: Array<number>;
  type?: number;
};

export type AffinityV1PersonGetNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1PersonGetParams> & { credentials?: Credentials };
  output?: Items<AffinityV1PersonGetOutput>;
};