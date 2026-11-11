/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=loadBalancer, operation=get
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get a load balancer */
export type AwsElbV1LoadBalancerGetParams = {
  resource: 'loadBalancer';
  operation: 'get';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Unique identifier for a particular loadBalancer
 */
    loadBalancerId: string | Expression<string>;
};

export type AwsElbV1LoadBalancerGetNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1LoadBalancerGetParams> & { credentials?: Credentials };
};