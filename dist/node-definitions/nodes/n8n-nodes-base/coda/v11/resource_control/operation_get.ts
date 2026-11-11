/**
 * Coda Node - Version 1.1
 * Discriminator: resource=control, operation=get
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Controls provide a user-friendly way to input a value that can affect other parts of the doc */
export type CodaV11ControlGetParams = {
  resource: 'control';
  operation: 'get';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The control to get the row from
 */
    controlId: string | Expression<string>;
};

export type CodaV11ControlGetNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11ControlGetParams> & { credentials?: Credentials };
};