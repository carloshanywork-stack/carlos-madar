/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=loadBalancer, operation=getMany
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many load balancers */
export type AwsElbV1LoadBalancerGetManyParams = {
  resource: 'loadBalancer';
  operation: 'getMany';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @displayOptions.show { returnAll: [true] }
 * @default {}
 */
    filters?: {
    /** The names of the load balancers. Multiples can be defined separated by comma.
     */
    names?: string | Expression<string>;
  };
};

export type AwsElbV1LoadBalancerGetManyNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1LoadBalancerGetManyParams> & { credentials?: Credentials };
};