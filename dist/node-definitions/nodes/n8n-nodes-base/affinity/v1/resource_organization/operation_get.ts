/**
 * Affinity Node - Version 1
 * Discriminator: resource=organization, operation=get
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get a list */
export type AffinityV1OrganizationGetParams = {
  resource: 'organization';
  operation: 'get';
/**
 * Unique identifier for the organization
 */
    organizationId: string | Expression<string>;
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

export type AffinityV1OrganizationGetOutput = {
  crunchbase_uuid?: null;
  domain?: string;
  domains?: Array<string>;
  global?: boolean;
  id?: number;
  list_entries?: Array<{
    created_at?: string;
    creator_id?: number;
    entity_id?: number;
    entity_type?: number;
    id?: number;
    list_id?: number;
  }>;
  name?: string;
  person_ids?: Array<number>;
};

export type AffinityV1OrganizationGetNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1OrganizationGetParams> & { credentials?: Credentials };
  output?: Items<AffinityV1OrganizationGetOutput>;
};