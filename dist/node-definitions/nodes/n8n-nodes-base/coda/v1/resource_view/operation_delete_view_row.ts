/**
 * Coda Node - Version 1
 * Discriminator: resource=view, operation=deleteViewRow
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV1ViewDeleteViewRowParams = {
  resource: 'view';
  operation: 'deleteViewRow';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The view to get the row from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getViews
 */
    viewId: string | Expression<string>;
/**
 * The view to get the row from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getViewRows
 */
    rowId: string | Expression<string>;
};

export type CodaV1ViewDeleteViewRowNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1ViewDeleteViewRowParams> & { credentials?: Credentials };
};