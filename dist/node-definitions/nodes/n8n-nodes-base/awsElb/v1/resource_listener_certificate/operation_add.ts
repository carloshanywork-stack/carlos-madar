/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=listenerCertificate, operation=add
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Add the specified SSL server certificate to the certificate list for the specified HTTPS or TLS listener */
export type AwsElbV1ListenerCertificateAddParams = {
  resource: 'listenerCertificate';
  operation: 'add';
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
 * Unique identifier for a particular loadBalancer
 */
    certificateId: string | Expression<string>;
};

export type AwsElbV1ListenerCertificateAddNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1ListenerCertificateAddParams> & { credentials?: Credentials };
};