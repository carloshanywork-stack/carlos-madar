/**
 * Bubble Node - Version 1
 * Discriminator: resource=object, operation=delete
 */


interface Credentials {
  bubbleApi: CredentialReference;
}

export type BubbleV1ObjectDeleteParams = {
  resource: 'object';
  operation: 'delete';
/**
 * Name of data type of the object to retrieve
 */
    typeName: string | Expression<string>;
/**
 * ID of the object to retrieve
 */
    objectId: string | Expression<string>;
};

export type BubbleV1ObjectDeleteOutput = {
  success?: boolean;
};

export type BubbleV1ObjectDeleteNode = {
  type: 'n8n-nodes-base.bubble';
  version: 1;
  config: NodeConfig<BubbleV1ObjectDeleteParams> & { credentials?: Credentials };
  output?: Items<BubbleV1ObjectDeleteOutput>;
};