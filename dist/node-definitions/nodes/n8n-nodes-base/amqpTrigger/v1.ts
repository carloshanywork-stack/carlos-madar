/**
 * AMQP Trigger Node - Version 1
 * Listens to AMQP 1.0 messages
 */


export interface AmqpTriggerV1Params {
/**
 * Name of the queue or topic to listen to
 */
    sink?: string | Expression<string>;
/**
 * Leave empty for non-durable topic subscriptions or queues
 * @hint For durable/persistent topic subscriptions
 */
    clientname?: string | Expression<string>;
/**
 * Leave empty for non-durable topic subscriptions or queues
 * @hint For durable/persistent topic subscriptions
 */
    subscription?: string | Expression<string>;
  options?: {
    /** Will be passed to the RHEA backend as container_id
     */
    containerId?: string | Expression<string>;
    /** Whether to convert JSON body content (["body"]["content"]) from byte array to string. Needed for Azure Service Bus.
     * @default false
     */
    jsonConvertByteArrayToString?: boolean | Expression<boolean>;
    /** Whether to parse the body to an object
     * @default false
     */
    jsonParseBody?: boolean | Expression<boolean>;
    /** Number of messages to pull from the bus for every cycle
     * @default 100
     */
    pullMessagesNumber?: number | Expression<number>;
    /** Whether to return only the body property
     * @default false
     */
    onlyBody?: boolean | Expression<boolean>;
    /** Whether to process messages in parallel
     * @default true
     */
    parallelProcessing?: boolean | Expression<boolean>;
    /** Whether to automatically reconnect if disconnected
     * @default true
     */
    reconnect?: boolean | Expression<boolean>;
    /** Maximum number of reconnect attempts
     * @default 50
     */
    reconnectLimit?: number | Expression<number>;
    /** Milliseconds to sleep after every cycle
     * @default 10
     */
    sleepTime?: number | Expression<number>;
  };
}

export interface AmqpTriggerV1Credentials {
  amqp: CredentialReference;
}

interface AmqpTriggerV1NodeBase {
  type: 'n8n-nodes-base.amqpTrigger';
  version: 1;
  isTrigger: true;
}

export type AmqpTriggerV1ParamsNode = AmqpTriggerV1NodeBase & {
  config: NodeConfig<AmqpTriggerV1Params> & { credentials?: AmqpTriggerV1Credentials };
};

export type AmqpTriggerV1Node = AmqpTriggerV1ParamsNode;