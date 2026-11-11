/**
 * AWS Textract Node - Version 1
 * Sends data to Amazon Textract
 */


export interface AwsTextractV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  operation?: 'analyzeExpense';
/**
 * The name of the input field containing the binary file data to be uploaded. Supported file types: PNG, JPEG.
 * @displayOptions.show { operation: ["analyzeExpense"] }
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @displayOptions.show { operation: ["analyzeExpense"] }
 * @default true
 */
    simple?: boolean | Expression<boolean>;
}

export interface AwsTextractV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsTextractV1NodeBase {
  type: 'n8n-nodes-base.awsTextract';
  version: 1;
}

export type AwsTextractV1ParamsNode = AwsTextractV1NodeBase & {
  config: NodeConfig<AwsTextractV1Params> & { credentials?: AwsTextractV1Credentials };
};

export type AwsTextractV1Node = AwsTextractV1ParamsNode;