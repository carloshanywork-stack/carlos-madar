/**
 * Affinity Node - Version 1
 * Discriminator: resource=listEntry, operation=getAll
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get many lists */
export type AffinityV1ListEntryGetAllParams = {
  resource: 'listEntry';
  operation: 'getAll';
/**
 * The unique ID of the list whose list entries are to be retrieved. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLists
 */
    listId?: string | Expression<string>;
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

export type AffinityV1ListEntryGetAllOutput = {
  created_at?: string;
  creator_id?: number;
  entity?: {
    crunchbase_uuid?: null;
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

export type AffinityV1ListEntryGetAllNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1ListEntryGetAllParams> & { credentials?: Credentials };
  output?: Items<AffinityV1ListEntryGetAllOutput>;
};