/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=member
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get task members */
export type ClickUpV1ListMemberParams = {
  resource: 'list';
  operation: 'member';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    id: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default true
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
};

export type ClickUpV1ListMemberOutput = {
  email?: string;
  id?: number;
  initials?: string;
  profileInfo?: {
    verified_consultant?: null;
    viewed_verified_consultant?: null;
  };
};

export type ClickUpV1ListMemberNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListMemberParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ListMemberOutput>;
};