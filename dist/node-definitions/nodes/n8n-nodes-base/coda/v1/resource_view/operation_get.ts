/**
 * Coda Node - Version 1
 * Discriminator: resource=view, operation=get
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV1ViewGetParams = {
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

export type CodaV1ViewGetOutput = {
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

export type CodaV1ViewGetNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1ViewGetParams> & { credentials?: Credentials };
  output?: Items<CodaV1ViewGetOutput>;
};