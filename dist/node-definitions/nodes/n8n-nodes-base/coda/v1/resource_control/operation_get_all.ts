/**
 * Coda Node - Version 1
 * Discriminator: resource=control, operation=getAll
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Controls provide a user-friendly way to input a value that can affect other parts of the doc */
export type CodaV1ControlGetAllParams = {
  resource: 'control';
  operation: 'getAll';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
};

export type CodaV1ControlGetAllNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1ControlGetAllParams> & { credentials?: Credentials };
};