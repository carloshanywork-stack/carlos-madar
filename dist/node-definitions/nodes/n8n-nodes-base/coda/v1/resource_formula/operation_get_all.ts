/**
 * Coda Node - Version 1
 * Discriminator: resource=formula, operation=getAll
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Formulas can be great for performing one-off computations */
export type CodaV1FormulaGetAllParams = {
  resource: 'formula';
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

export type CodaV1FormulaGetAllNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1FormulaGetAllParams> & { credentials?: Credentials };
};