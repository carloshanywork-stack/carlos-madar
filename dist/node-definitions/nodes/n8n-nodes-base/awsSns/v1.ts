/**
 * AWS SNS Node - Version 1
 * Sends data to AWS SNS
 */


export interface AwsSnsV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  operation?: 'create' | 'delete' | 'publish';
/**
 * Name
 * @displayOptions.show { operation: ["create"] }
 * @required when the displayOptions conditions above match
 */
    name?: string | Expression<string>;
/**
 * Options
 * @displayOptions.show { operation: ["create"] }
 * @default {}
 */
    options?: {
    /** The display name to use for a topic with SMS subscriptions
     */
    displayName?: string | Expression<string>;
    /** Whether the topic you want to create is a FIFO (first-in-first-out) topic
     * @default false
     */
    fifoTopic?: boolean | Expression<boolean>;
  };
/**
 * Topic
 * @searchListMethod listTopics
 * @displayOptions.show { operation: ["publish", "delete"] }
 * @default {"mode":"list","value":""}
 */
    topic?: { __rl: true; mode: 'list' | 'url' | 'id'; value: string; cachedResultName?: string };
/**
 * Subject when the message is delivered to email endpoints
 * @displayOptions.show { operation: ["publish"] }
 * @required when the displayOptions conditions above match
 */
    subject?: string | Expression<string>;
/**
 * The message you want to send
 * @displayOptions.show { operation: ["publish"] }
 * @required when the displayOptions conditions above match
 */
    message?: string | Expression<string>;
}

export interface AwsSnsV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsSnsV1NodeBase {
  type: 'n8n-nodes-base.awsSns';
  version: 1;
}

export type AwsSnsV1ParamsNode = AwsSnsV1NodeBase & {
  config: NodeConfig<AwsSnsV1Params> & { credentials?: AwsSnsV1Credentials };
};

export type AwsSnsV1Node = AwsSnsV1ParamsNode;