/**
 * CircleCI Node - Version 1
 * Discriminator: resource=pipeline, operation=trigger
 */


interface Credentials {
  circleCiApi: CredentialReference;
}

/** Trigger a pipeline */
export type CircleCiV1PipelineTriggerParams = {
  resource: 'pipeline';
  operation: 'trigger';
/**
 * Source control system
 */
    vcs?: 'bitbucket' | 'github' | Expression<string>;
/**
 * Project slug in the form org-name/repo-name
 */
    projectSlug?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The branch where the pipeline ran. The HEAD commit on this branch was used for the pipeline. Note that branch and tag are mutually exclusive.
     */
    branch?: string | Expression<string>;
    /** The tag used by the pipeline. The commit that this tag points to was used for the pipeline. Note that branch and tag are mutually exclusive
     */
    tag?: string | Expression<string>;
  };
};

export type CircleCiV1PipelineTriggerNode = {
  type: 'n8n-nodes-base.circleCi';
  version: 1;
  config: NodeConfig<CircleCiV1PipelineTriggerParams> & { credentials?: Credentials };
};