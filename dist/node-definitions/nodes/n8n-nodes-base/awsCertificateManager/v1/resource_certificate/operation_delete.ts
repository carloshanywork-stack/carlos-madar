/**
 * AWS Certificate Manager Node - Version 1
 * Discriminator: resource=certificate, operation=delete
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Delete a certificate */
export type AwsCertificateManagerV1CertificateDeleteParams = {
  resource: 'certificate';
  operation: 'delete';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * String that contains the ARN of the ACM certificate to be renewed. This must be of the form: arn:aws:acm:region:123456789012:certificate/12345678-1234-1234-1234-123456789012.
 */
    certificateArn: string | Expression<string>;
/**
 * Bucket Name
 */
    bucketName: string | Expression<string>;
/**
 * Certificate Key
 */
    certificateKey: string | Expression<string>;
};

export type AwsCertificateManagerV1CertificateDeleteNode = {
  type: 'n8n-nodes-base.awsCertificateManager';
  version: 1;
  config: NodeConfig<AwsCertificateManagerV1CertificateDeleteParams> & { credentials?: Credentials };
};