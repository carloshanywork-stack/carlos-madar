/**
 * Netscaler ADC Node - Version 1
 * Discriminator: resource=certificate, operation=install
 */


interface Credentials {
  citrixAdcApi: CredentialReference;
}

export type CitrixAdcV1CertificateInstallParams = {
  resource: 'certificate';
  operation: 'install';
/**
 * Name for the certificate and private-key pair
 */
    certificateKeyPairName: string | Expression<string>;
/**
 * Name of and, optionally, path to the X509 certificate file that is used to form the certificate-key pair. /nsconfig/ssl/ is the default path.
 */
    certificateFileName: string | Expression<string>;
/**
 * Name of and, optionally, path to the X509 certificate file that is used to form the certificate-key pair. /nsconfig/ssl/ is the default path.
 */
    privateKeyFileName: string | Expression<string>;
/**
 * Input format of the certificate and the private-key files. The three formats supported by the appliance are: PEM - Privacy Enhanced Mail DER - Distinguished Encoding Rule PFX - Personal Information Exchange.
 * @default PEM
 */
    certificateFormat?: 'PEM' | 'DER' | Expression<string>;
/**
 * Input format of the certificate and the private-key files. The three formats supported by the appliance are: PEM - Privacy Enhanced Mail DER - Distinguished Encoding Rule PFX - Personal Information Exchange.
 * @displayOptions.show { certificateFormat: ["PEM"] }
 * @required when the displayOptions conditions above match
 */
    password?: string | Expression<string>;
/**
 * Whether to alert when the certificate is about to expire
 * @default false
 */
    notifyExpiration?: boolean | Expression<boolean>;
/**
 * Time, in number of days, before certificate expiration, at which to generate an alert that the certificate is about to expire
 * @displayOptions.show { notifyExpiration: [true] }
 * @default 10
 */
    notificationPeriod?: number | Expression<number>;
/**
 * Whether to parse the certificate chain as a single file after linking the server certificate to its issuer's certificate within the file
 * @displayOptions.show { certificateFormat: ["PEM"] }
 * @default false
 */
    certificateBundle?: boolean | Expression<boolean>;
};

export type CitrixAdcV1CertificateInstallNode = {
  type: 'n8n-nodes-base.citrixAdc';
  version: 1;
  config: NodeConfig<CitrixAdcV1CertificateInstallParams> & { credentials?: Credentials };
};