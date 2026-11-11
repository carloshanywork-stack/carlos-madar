/**
 * Bubble Node - Version 1
 * Discriminator: resource=object, operation=create
 */


interface Credentials {
  bubbleApi: CredentialReference;
}

export type BubbleV1ObjectCreateParams = {
  resource: 'object';
  operation: 'create';
/**
 * Name of data type of the object to create
 */
    typeName: string | Expression<string>;
/**
 * Properties
 * @default {}
 */
    properties?: {
        /** Property
     */
    property?: Array<{
      /** Field to set for the object to create
       */
      key?: string | Expression<string>;
      /** Value to set for the object to create
       */
      value?: string | Expression<string>;
    }>;
  };
};

export type BubbleV1ObjectCreateOutput = {
  id?: string;
  status?: string;
};

export type BubbleV1ObjectCreateNode = {
  type: 'n8n-nodes-base.bubble';
  version: 1;
  config: NodeConfig<BubbleV1ObjectCreateParams> & { credentials?: Credentials };
  output?: Items<BubbleV1ObjectCreateOutput>;
};