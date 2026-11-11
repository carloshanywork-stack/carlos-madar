/**
 * AWS Certificate Manager Node - Version 1
 * Discriminator: resource=certificate, operation=getMetadata
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get certificate metadata */
export type AwsCertificateManagerV1CertificateGetMetadataParams = {
  resource: 'certificate';
  operation: 'getMetadata';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * String that contains the ARN of the ACM certificate to be renewed. This must be of the form: arn:aws:acm:region:123456789012:certificate/12345678-1234-1234-1234-123456789012.
 */
    certificateArn: string | Expression<string>;
};

export type AwsCertificateManagerV1CertificateGetMetadataNode = {
  type: 'n8n-nodes-base.awsCertificateManager';
  version: 1;
  config: NodeConfig<AwsCertificateManagerV1CertificateGetMetadataParams> & { credentials?: Credentials };
};