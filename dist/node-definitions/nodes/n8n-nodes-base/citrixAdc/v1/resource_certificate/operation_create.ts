/**
 * Netscaler ADC Node - Version 1
 * Discriminator: resource=certificate, operation=create
 */


interface Credentials {
  citrixAdcApi: CredentialReference;
}

export type CitrixAdcV1CertificateCreateParams = {
  resource: 'certificate';
  operation: 'create';
/**
 * Name for and, optionally, path to the generated certificate file. /nsconfig/ssl/ is the default path.
 */
    certificateFileName: string | Expression<string>;
/**
 * Format in which the certificate is stored on the appliance
 * @default PEM
 */
    certificateFormat?: 'PEM' | 'DER' | Expression<string>;
/**
 * Certificate Type
 * @default ROOT_CERT
 */
    certificateType?: 'ROOT_CERT' | 'INTM_CERT' | 'SRVR_CERT' | 'CLNT_CERT' | Expression<string>;
/**
 * Name for and, optionally, path to the certificate-signing request (CSR). /nsconfig/ssl/ is the default path.
 */
    certificateRequestFileName: string | Expression<string>;
/**
 * Name of the CA certificate file that issues and signs the Intermediate-CA certificate or the end-user client and server certificates
 * @displayOptions.show { certificateType: ["INTM_CERT", "SRVR_CERT", "CLNT_CERT"] }
 * @required when the displayOptions conditions above match
 */
    caCertificateFileName?: string | Expression<string>;
/**
 * Format of the CA certificate
 * @displayOptions.show { certificateType: ["INTM_CERT", "SRVR_CERT", "CLNT_CERT"] }
 * @default PEM
 */
    caCertificateFileFormat?: 'PEM' | 'DER' | Expression<string>;
/**
 * Private key, associated with the CA certificate that is used to sign the Intermediate-CA certificate or the end-user client and server certificate. If the CA key file is password protected, the user is prompted to enter the pass phrase that was used to encrypt the key.
 * @displayOptions.show { certificateType: ["INTM_CERT", "SRVR_CERT", "CLNT_CERT"] }
 * @required when the displayOptions conditions above match
 */
    caPrivateKeyFileName?: string | Expression<string>;
/**
 * Format of the CA certificate
 * @displayOptions.show { certificateType: ["INTM_CERT", "SRVR_CERT", "CLNT_CERT"] }
 * @default PEM
 */
    caPrivateKeyFileFormat?: 'PEM' | 'DER' | Expression<string>;
/**
 * Name for and, optionally, path to the private key. You can either use an existing RSA or DSA key that you own or create a new private key on the Netscaler ADC. This file is required only when creating a self-signed Root-CA certificate. The key file is stored in the /nsconfig/ssl directory by default.
 * @displayOptions.show { certificateType: ["ROOT_CERT"] }
 * @required when the displayOptions conditions above match
 */
    privateKeyFileName?: string | Expression<string>;
/**
 * Serial number file maintained for the CA certificate. This file contains the serial number of the next certificate to be issued or signed by the CA.
 * @displayOptions.show { certificateType: ["INTM_CERT", "SRVR_CERT", "CLNT_CERT"] }
 * @required when the displayOptions conditions above match
 */
    caSerialFileNumber?: string | Expression<string>;
/**
 * Format in which the key is stored on the appliance
 * @displayOptions.show { certificateType: ["ROOT_CERT"] }
 * @default PEM
 */
    privateKeyFormat?: 'PEM' | 'DER' | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Name for and, optionally, path to the private key. You can either use an existing RSA or DSA key that you own or create a new private key on the Netscaler ADC. This file is required only when creating a self-signed Root-CA certificate. The key file is stored in the /nsconfig/ssl directory by default.
     */
    pempassphrase?: string | Expression<string>;
    /** Subject Alternative Name (SAN) is an extension to X.509 that allows various values to be associated with a security certificate using a subjectAltName field
     */
    subjectaltname?: string | Expression<string>;
    /** Number of days for which the certificate will be valid, beginning with the time and day (system time) of creation
     */
    days?: string | Expression<string>;
  };
};

export type CitrixAdcV1CertificateCreateNode = {
  type: 'n8n-nodes-base.citrixAdc';
  version: 1;
  config: NodeConfig<CitrixAdcV1CertificateCreateParams> & { credentials?: Credentials };
};