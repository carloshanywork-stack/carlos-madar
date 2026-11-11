/**
 * Coda Node - Version 1.1
 * Discriminator: resource=view, operation=updateViewRow
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV11ViewUpdateViewRowParams = {
  resource: 'view';
  operation: 'updateViewRow';
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
/**
 * The view to get the row from
 * @default columns
 */
    keyName?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether the API will not attempt to parse the data in any way
     * @default false
     */
    disableParsing?: boolean | Expression<boolean>;
  };
};

export type CodaV11ViewUpdateViewRowNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11ViewUpdateViewRowParams> & { credentials?: Credentials };
};