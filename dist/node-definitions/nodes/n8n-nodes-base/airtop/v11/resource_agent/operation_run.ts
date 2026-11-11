/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=agent, operation=run
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

interface Credentials {
  airtopApi: CredentialReference;
}

/** Run an Airtop agent */
export type AirtopV11AgentRunParams = {
  resource: 'agent';
  operation: 'run';
/**
 * The Airtop agent to run. Visit &lt;a href="https://portal.airtop.ai/agents" target="_blank"&gt;Airtop Agents&lt;/a&gt; for more information.
 * @searchListMethod listSearchAgents
 * @default {"mode":"list","value":""}
 */
    agentId?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Agent Parameters
 * @displayOptions.hide { agentId: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    agentParameters?: ResourceMapperValue;
/**
 * The Airtop browser profile ID the agent should use for this run. Leave empty to use the agent's default profile.
 * @hint Copy the ID from your &lt;a href="https://portal.airtop.ai/browser-profiles" target="_blank"&gt;Browser Profiles&lt;/a&gt; page, not the profile's display name
 */
    profileName?: string | Expression<string>;
/**
 * Whether to wait for the agent to complete its execution
 * @default true
 */
    awaitExecution?: boolean | Expression<boolean>;
/**
 * Timeout in seconds to wait for the agent to finish
 * @displayOptions.show { awaitExecution: [true] }
 * @default 600
 */
    timeout?: number | Expression<number>;
};

export type AirtopV11AgentRunOutput = {
  invocationId?: string;
  status?: string;
  output?: {
    error?: boolean;
    success?: boolean;
  };
};

export type AirtopV11AgentRunNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11AgentRunParams> & { credentials?: Credentials };
  output?: Items<AirtopV11AgentRunOutput>;
};