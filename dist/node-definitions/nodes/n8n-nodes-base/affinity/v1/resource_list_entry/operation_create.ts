/**
 * Affinity Node - Version 1
 * Discriminator: resource=listEntry, operation=create
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Create a list entry */
export type AffinityV1ListEntryCreateParams = {
  resource: 'listEntry';
  operation: 'create';
/**
 * The unique ID of the list whose list entries are to be retrieved. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLists
 */
    listId: string | Expression<string>;
/**
 * The unique ID of the entity (person, organization, or opportunity) to add to this list
 */
    entityId: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The ID of a Person resource who should be recorded as adding the entry to the list. Must be a person who can access Affinity. If not provided the creator defaults to the owner of the API key.
     */
    creator_id?: string | Expression<string>;
  };
};

export type AffinityV1ListEntryCreateOutput = {
  created_at?: string;
  creator_id?: number;
  entity?: {
    crunchbase_uuid?: null;
    domain?: string;
    domains?: Array<string>;
    global?: boolean;
    id?: number;
    name?: string;
  };
  entity_id?: number;
  entity_type?: number;
  id?: number;
  list_id?: number;
};

export type AffinityV1ListEntryCreateNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1ListEntryCreateParams> & { credentials?: Credentials };
  output?: Items<AffinityV1ListEntryCreateOutput>;
};