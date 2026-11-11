/**
 * Coda Node - Version 1.1
 * Discriminator: resource=view, operation=getAll
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV11ViewGetAllParams = {
  resource: 'view';
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

export type CodaV11ViewGetAllOutput = {
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
};

export type CodaV11ViewGetAllNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11ViewGetAllParams> & { credentials?: Credentials };
  output?: Items<CodaV11ViewGetAllOutput>;
};