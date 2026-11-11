/**
 * Asana Node - Version 1
 * Discriminator: resource=user, operation=get
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get a task */
export type AsanaV1UserGetParams = {
  resource: 'user';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * An identifier for the user to get data of. Can be one of an email address,the globally unique identifier for the user, or the keyword me to indicate the current user making the request.
 */
    userId: string | Expression<string>;
};

export type AsanaV1UserGetOutput = {
  email?: string;
  gid?: string;
  name?: string;
  photo?: {
    image_128x128?: string;
    image_21x21?: string;
    image_27x27?: string;
    image_36x36?: string;
    image_60x60?: string;
  };
  resource_type?: string;
  workspaces?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
};

export type AsanaV1UserGetNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1UserGetParams> & { credentials?: Credentials };
  output?: Items<AsanaV1UserGetOutput>;
};