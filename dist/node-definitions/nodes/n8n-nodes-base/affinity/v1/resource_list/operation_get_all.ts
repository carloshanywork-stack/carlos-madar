/**
 * Affinity Node - Version 1
 * Discriminator: resource=list, operation=getAll
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get many lists */
export type AffinityV1ListGetAllParams = {
  resource: 'list';
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

export type AffinityV1ListGetAllOutput = {
  creator_id?: number;
  id?: number;
  list_size?: number;
  name?: string;
  owner_id?: number;
  public?: boolean;
  type?: number;
};

export type AffinityV1ListGetAllNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1ListGetAllParams> & { credentials?: Credentials };
  output?: Items<AffinityV1ListGetAllOutput>;
};