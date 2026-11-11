/**
 * AWS Certificate Manager Node - Version 1
 * Discriminator: resource=certificate, operation=getMany
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many certificates */
export type AwsCertificateManagerV1CertificateGetManyParams = {
  resource: 'certificate';
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
 * Options
 * @default {}
 */
    options?: {
    /** Filter the certificate list by status value
     * @default []
     */
    certificateStatuses?: Array<'EXPIRED' | 'FAILED' | 'INACTIVE' | 'ISSUED' | 'PENDING_VALIDATION' | 'REVOKED' | 'VALIDATION_TIMED_OUT'>;
    /** Specify one or more ExtendedKeyUsage extension values
     * @default []
     */
    extendedKeyUsage?: Array<'ANY' | 'CODE_SIGNING' | 'CUSTOM' | 'EMAIL_PROTECTION' | 'IPSEC_END_SYSTEM' | 'IPSEC_TUNNEL' | 'IPSEC_USER' | 'NONE' | 'OCSP_SIGNING' | 'TIME_STAMPING' | 'TLS_WEB_CLIENT_AUTHENTICATION' | 'TLS_WEB_SERVER_AUTHENTICATION'>;
    /** Specify one or more algorithms that can be used to generate key pairs
     * @default ["RSA_2048"]
     */
    keyTypes?: Array<'EC_prime256v1' | 'EC_secp384r1' | 'EC_secp521r1' | 'RSA_1024' | 'RSA_2048' | 'RSA_4096'>;
    /** Specify one or more KeyUsage extension values
     * @default []
     */
    keyUsage?: Array<'ANY' | 'CERTIFICATE_SIGNING' | 'CRL_SIGNING' | 'CUSTOM' | 'DATA_ENCIPHERMENT' | 'DECIPHER_ONLY' | 'DIGITAL_SIGNATURE' | 'ENCIPHER_ONLY' | 'KEY_AGREEMENT' | 'KEY_ENCIPHERMENT' | 'NON_REPUDIATION'>;
  };
};

export type AwsCertificateManagerV1CertificateGetManyNode = {
  type: 'n8n-nodes-base.awsCertificateManager';
  version: 1;
  config: NodeConfig<AwsCertificateManagerV1CertificateGetManyParams> & { credentials?: Credentials };
};