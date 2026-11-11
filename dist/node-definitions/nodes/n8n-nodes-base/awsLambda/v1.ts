/**
 * AWS Lambda Node - Version 1
 * Invoke functions on AWS Lambda
 */


export interface AwsLambdaV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  operation?: 'invoke';
/**
 * The function you want to invoke. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getFunctions
 * @displayOptions.show { operation: ["invoke"] }
 * @required when the displayOptions conditions above match
 */
    'function'?: string | Expression<string>;
/**
 * Specify a version or alias to invoke a published version of the function
 * @displayOptions.show { operation: ["invoke"] }
 * @default $LATEST
 */
    qualifier?: string | Expression<string>;
/**
 * Specify if the workflow should wait for the function to return the results
 * @displayOptions.show { operation: ["invoke"] }
 * @default RequestResponse
 */
    invocationType?: 'RequestResponse' | 'Event' | Expression<string>;
/**
 * The JSON that you want to provide to your Lambda function as input
 * @displayOptions.show { operation: ["invoke"] }
 */
    payload?: string | Expression<string>;
}

export interface AwsLambdaV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsLambdaV1NodeBase {
  type: 'n8n-nodes-base.awsLambda';
  version: 1;
}

export type AwsLambdaV1ParamsNode = AwsLambdaV1NodeBase & {
  config: NodeConfig<AwsLambdaV1Params> & { credentials?: AwsLambdaV1Credentials };
};

export type AwsLambdaV1Node = AwsLambdaV1ParamsNode;