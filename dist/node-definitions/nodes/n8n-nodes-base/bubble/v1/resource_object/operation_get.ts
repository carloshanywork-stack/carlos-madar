/**
 * Bubble Node - Version 1
 * Discriminator: resource=object, operation=get
 */


interface Credentials {
  bubbleApi: CredentialReference;
}

export type BubbleV1ObjectGetParams = {
  resource: 'object';
  operation: 'get';
/**
 * Name of data type of the object to retrieve
 */
    typeName: string | Expression<string>;
/**
 * ID of the object to retrieve
 */
    objectId: string | Expression<string>;
};

export type BubbleV1ObjectGetOutput = {
  _id?: string;
  agencia?: string;
  'Created By'?: string;
  'Created Date'?: string;
  'Modified Date'?: string;
};

export type BubbleV1ObjectGetNode = {
  type: 'n8n-nodes-base.bubble';
  version: 1;
  config: NodeConfig<BubbleV1ObjectGetParams> & { credentials?: Credentials };
  output?: Items<BubbleV1ObjectGetOutput>;
};