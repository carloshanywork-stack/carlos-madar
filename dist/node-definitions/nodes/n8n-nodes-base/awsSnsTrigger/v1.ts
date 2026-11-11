/**
 * AWS SNS Trigger Node - Version 1
 * Handle AWS SNS events via webhooks
 */


export interface AwsSnsTriggerV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  topic?: { __rl: true; mode: 'list' | 'url' | 'id'; value: string; cachedResultName?: string };
}

export interface AwsSnsTriggerV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsSnsTriggerV1NodeBase {
  type: 'n8n-nodes-base.awsSnsTrigger';
  version: 1;
  isTrigger: true;
}

export type AwsSnsTriggerV1ParamsNode = AwsSnsTriggerV1NodeBase & {
  config: NodeConfig<AwsSnsTriggerV1Params> & { credentials?: AwsSnsTriggerV1Credentials };
};

export type AwsSnsTriggerV1Node = AwsSnsTriggerV1ParamsNode;