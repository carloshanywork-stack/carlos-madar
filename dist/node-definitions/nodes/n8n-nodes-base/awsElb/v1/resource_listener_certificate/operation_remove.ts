/**
 * AWS ELB Node - Version 1
 * Discriminator: resource=listenerCertificate, operation=remove
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Remove the specified certificate from the certificate list for the specified HTTPS or TLS listener */
export type AwsElbV1ListenerCertificateRemoveParams = {
  resource: 'listenerCertificate';
  operation: 'remove';
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

export type AwsElbV1ListenerCertificateRemoveNode = {
  type: 'n8n-nodes-base.awsElb';
  version: 1;
  config: NodeConfig<AwsElbV1ListenerCertificateRemoveParams> & { credentials?: Credentials };
};