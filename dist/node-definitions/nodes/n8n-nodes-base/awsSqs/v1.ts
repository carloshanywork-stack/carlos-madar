/**
 * AWS SQS Node - Version 1
 * Sends messages to AWS SQS
 */


export interface AwsSqsV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  operation?: 'sendMessage';
/**
 * Queue to send a message to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getQueues
 * @displayOptions.show { operation: ["sendMessage"] }
 * @required when the displayOptions conditions above match
 */
    queue?: string | Expression<string>;
  queueType?: 'fifo' | 'standard' | Expression<string>;
/**
 * Whether to send the data the node receives as JSON to SQS
 * @default true
 */
    sendInputData?: boolean | Expression<boolean>;
/**
 * Message to send to the queue
 * @displayOptions.show { operation: ["sendMessage"], sendInputData: [false] }
 * @required when the displayOptions conditions above match
 */
    message?: string | Expression<string>;
/**
 * Tag that specifies that a message belongs to a specific message group. Applies only to FIFO (first-in-first-out) queues.
 * @displayOptions.show { queueType: ["fifo"] }
 * @required when the displayOptions conditions above match
 */
    messageGroupId?: string | Expression<string>;
/**
 * Options
 * @displayOptions.show { operation: ["sendMessage"] }
 * @default {}
 */
    options?: {
    /** How long, in seconds, to delay a message for
     * @displayOptions.show { /queueType: ["standard"] }
     * @default 0
     */
    delaySeconds?: number | Expression<number>;
    /** Attributes to set
     * @default {}
     */
    messageAttributes?: {
        /** Binary
     */
    binary?: Array<{
      /** Name of the attribute
       */
      name?: string | Expression<string>;
      /** Name of the binary property which contains the data for the message attribute
       * @default data
       */
      dataPropertyName?: string | Expression<string>;
    }>;
        /** Number
     */
    number?: Array<{
      /** Name of the attribute
       */
      name?: string | Expression<string>;
      /** Number value of the attribute
       * @default 0
       */
      value?: number | Expression<number>;
    }>;
        /** String
     */
    string?: Array<{
      /** Name of the attribute
       */
      name?: string | Expression<string>;
      /** String value of attribute
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Token used for deduplication of sent messages. Applies only to FIFO (first-in-first-out) queues.
     * @displayOptions.show { /queueType: ["fifo"] }
     */
    messageDeduplicationId?: string | Expression<string>;
  };
}

export interface AwsSqsV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsSqsV1NodeBase {
  type: 'n8n-nodes-base.awsSqs';
  version: 1;
}

export type AwsSqsV1ParamsNode = AwsSqsV1NodeBase & {
  config: NodeConfig<AwsSqsV1Params> & { credentials?: AwsSqsV1Credentials };
};

export type AwsSqsV1Node = AwsSqsV1ParamsNode;