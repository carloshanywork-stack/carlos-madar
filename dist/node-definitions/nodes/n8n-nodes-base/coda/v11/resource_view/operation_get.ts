/**
 * Coda Node - Version 1.1
 * Discriminator: resource=view, operation=get
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV11ViewGetParams = {
  resource: 'view';
  operation: 'get';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The view to get the row from
 */
    viewId: string | Expression<string>;
};

export type CodaV11ViewGetOutput = {
  href?: string;
  items?: Array<{
    browserLink?: string;
    href?: string;
    id?: string;
    name?: string;
    parent?: {
      browserLink?: string;
      href?: string;
      id?: string;
      name?: string;
      type?: string;
    };
    tableType?: string;
    type?: string;
  }>;
};

export type CodaV11ViewGetNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11ViewGetParams> & { credentials?: Credentials };
  output?: Items<CodaV11ViewGetOutput>;
};