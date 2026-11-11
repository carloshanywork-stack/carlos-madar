/**
 * Cockpit Node - Version 1
 * Discriminator: resource=collection, operation=create
 */


interface Credentials {
  cockpitApi: CredentialReference;
}

/** Create a collection entry */
export type CockpitV1CollectionCreateParams = {
  resource: 'collection';
  operation: 'create';
/**
 * Name of the collection to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getCollections
 */
    collection: string | Expression<string>;
/**
 * Whether new entry fields should be set via the value-key pair UI or JSON
 * @default false
 */
    jsonDataFields?: boolean | Expression<boolean>;
/**
 * Entry data to send as JSON
 * @displayOptions.show { jsonDataFields: [true] }
 */
    dataFieldsJson?: IDataObject | string | Expression<string>;
/**
 * Entry data to send
 * @displayOptions.show { jsonDataFields: [false] }
 * @default {}
 */
    dataFieldsUi?: {
        /** Field
     */
    field?: Array<{
      /** Name of the field
       */
      name?: string | Expression<string>;
      /** Value of the field
       */
      value?: string | Expression<string>;
    }>;
  };
};

export type CockpitV1CollectionCreateNode = {
  type: 'n8n-nodes-base.cockpit';
  version: 1;
  config: NodeConfig<CockpitV1CollectionCreateParams> & { credentials?: Credentials };
};