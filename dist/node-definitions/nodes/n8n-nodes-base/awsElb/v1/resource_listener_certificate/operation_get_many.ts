/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=listenerCertificate, operation=getMany
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many load balancers */
export type AwsElbV1ListenerCertificateGetManyParams = {
  resource: 'listenerCertificate';
  operation: 'getMany';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Unique identifier for a particular loadBalancer. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLoadBalancers
 */
    loadBalancerId: string | Expression<string>;
/**
 * Unique identifier for a particular loadBalancer. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLoadBalancerListeners
 */
    listenerId: string | Expression<string>;
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
};

export type AwsElbV1ListenerCertificateGetManyNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1ListenerCertificateGetManyParams> & { credentials?: Credentials };
};