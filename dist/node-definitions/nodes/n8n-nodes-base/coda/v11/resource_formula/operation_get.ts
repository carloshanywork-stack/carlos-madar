/**
 * Coda Node - Version 1.1
 * Discriminator: resource=formula, operation=get
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Formulas can be great for performing one-off computations */
export type CodaV11FormulaGetParams = {
  resource: 'formula';
  operation: 'get';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The formula to get the row from
 */
    formulaId: string | Expression<string>;
};

export type CodaV11FormulaGetNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11FormulaGetParams> & { credentials?: Credentials };
};