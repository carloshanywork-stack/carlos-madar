/**
 * AWS Certificate Manager Node - Version 1
 * Discriminator: resource=certificate, operation=renew
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Renew a certificate */
export type AwsCertificateManagerV1CertificateRenewParams = {
  resource: 'certificate';
  operation: 'renew';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * String that contains the ARN of the ACM certificate to be renewed. This must be of the form: arn:aws:acm:region:123456789012:certificate/12345678-1234-1234-1234-123456789012.
 */
    certificateArn: string | Expression<string>;
};

export type AwsCertificateManagerV1CertificateRenewNode = {
  type: 'n8n-nodes-base.awsCertificateManager';
  version: 1;
  config: NodeConfig<AwsCertificateManagerV1CertificateRenewParams> & { credentials?: Credentials };
};