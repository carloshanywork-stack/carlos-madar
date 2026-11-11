/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=loadBalancer, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Delete a load balancer */
export type AwsElbV1LoadBalancerDeleteParams = {
  resource: 'loadBalancer';
  operation: 'delete';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * ID of loadBalancer to delete
 */
    loadBalancerId: string | Expression<string>;
};

export type AwsElbV1LoadBalancerDeleteNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1LoadBalancerDeleteParams> & { credentials?: Credentials };
};