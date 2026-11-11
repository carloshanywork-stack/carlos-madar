/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=member, operation=getAll
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1MemberGetAllParams = {
  resource: 'member';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 10
 */
    limit?: number | Expression<number>;
};

export type BitwardenV1MemberGetAllOutput = {
  collections?: null;
  email?: string;
  id?: string;
  name?: string;
  object?: string;
  permissions?: null;
  resetPasswordEnrolled?: boolean;
  ssoExternalId?: null;
  status?: number;
  twoFactorEnabled?: boolean;
  type?: number;
  userId?: string;
};

export type BitwardenV1MemberGetAllNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1MemberGetAllParams> & { credentials?: Credentials };
  output?: Items<BitwardenV1MemberGetAllOutput>;
};