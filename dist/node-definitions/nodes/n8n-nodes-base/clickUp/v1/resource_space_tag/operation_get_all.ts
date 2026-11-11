/**
 * ClickUp Node - Version 1
 * Discriminator: resource=spaceTag, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1SpaceTagGetAllParams = {
  resource: 'spaceTag';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Space ID
 */
    space: string | Expression<string>;
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

export type ClickUpV1SpaceTagGetAllOutput = {
  name?: string;
  project_id?: string;
  tag_bg?: string;
  tag_fg?: string;
};

export type ClickUpV1SpaceTagGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1SpaceTagGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1SpaceTagGetAllOutput>;
};