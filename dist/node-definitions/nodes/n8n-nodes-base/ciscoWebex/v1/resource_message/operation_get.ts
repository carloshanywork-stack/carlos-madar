/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=message, operation=get
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MessageGetParams = {
  resource: 'message';
  operation: 'get';
/**
 * ID of the message to retrieve
 */
    messageId: string | Expression<string>;
};

export type CiscoWebexV1MessageGetOutput = {
  created?: string;
  id?: string;
  personEmail?: string;
  personId?: string;
  roomId?: string;
  roomType?: string;
  text?: string;
};

export type CiscoWebexV1MessageGetNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MessageGetParams> & { credentials?: Credentials };
  output?: Items<CiscoWebexV1MessageGetOutput>;
};