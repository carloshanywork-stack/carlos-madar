/**
 * AWS Transcribe Node - Version 1
 * Sends data to AWS Transcribe
 */


export interface AwsTranscribeV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  resource?: 'transcriptionJob';
  operation?: 'create' | 'delete' | 'get' | 'getAll';
/**
 * The name of the job
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["create", "get", "delete"] }
 */
    transcriptionJobName?: string | Expression<string>;
/**
 * The S3 object location of the input media file
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["create"] }
 */
    mediaFileUri?: string | Expression<string>;
/**
 * Whether to set this field to true to enable automatic language identification
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["create"] }
 * @default false
 */
    detectLanguage?: boolean | Expression<boolean>;
/**
 * Language used in the input media file
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["create"], detectLanguage: [false] }
 * @default en-US
 */
    languageCode?: 'en-US' | 'en-GB' | 'de-DE' | 'en-IN' | 'en-IE' | 'ru-RU' | 'es-ES' | Expression<string>;
/**
 * Options
 * @displayOptions.show { operation: ["create"] }
 * @default {}
 */
    options?: {
    /** Instructs Amazon Transcribe to process each audiochannel separately and then merge the transcription output of each channel into a single transcription. You can't set both Max Speaker Labels and Channel Identification in the same request. If you set both, your request returns a BadRequestException.
     * @default false
     */
    channelIdentification?: boolean | Expression<boolean>;
    /** The number of alternative transcriptions that the service should return
     * @default 2
     */
    maxAlternatives?: number | Expression<number>;
    /** The maximum number of speakers to identify in the input audio. If there are more speakers in the audio than this number, multiple speakers are identified as a single speaker.
     * @default 2
     */
    maxSpeakerLabels?: number | Expression<number>;
    /** Name of vocabulary to use when processing the transcription job
     */
    vocabularyName?: string | Expression<string>;
    /** The name of the vocabulary filter to use when transcribing the audio. The filter that you specify must have the same language code as the transcription job.
     */
    vocabularyFilterName?: string | Expression<string>;
    /** &lt;p&gt;Set to mask to remove filtered text from the transcript and replace it with three asterisks ("***") as placeholder text.&lt;/p&gt;&lt;p&gt;Set to remove to remove filtered text from the transcript without using placeholder text. Set to tag to mark the word in the transcription output that matches the vocabulary filter. When you set the filter method to tag, the words matching your vocabulary filter are not masked or removed.&lt;/p&gt;
     * @default remove
     */
    vocabularyFilterMethod?: 'remove' | 'mask' | 'tag' | Expression<string>;
  };
/**
 * By default, the response only contains metadata about the transcript. Enable this option to retrieve the transcript instead.
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["get"] }
 * @default true
 */
    returnTranscript?: boolean | Expression<boolean>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["get"], returnTranscript: [true] }
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["getAll"] }
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["getAll"], returnAll: [false] }
 * @default 20
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @displayOptions.show { resource: ["transcriptionJob"], operation: ["getAll"] }
 * @default {}
 */
    filters?: {
    /** Return only transcription jobs whose name contains the specified string
     */
    jobNameContains?: string | Expression<string>;
    /** Return only transcription jobs with the specified status
     * @default COMPLETED
     */
    status?: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'QUEUED' | Expression<string>;
  };
}

export interface AwsTranscribeV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsTranscribeV1NodeBase {
  type: 'n8n-nodes-base.awsTranscribe';
  version: 1;
}

export type AwsTranscribeV1ParamsNode = AwsTranscribeV1NodeBase & {
  config: NodeConfig<AwsTranscribeV1Params> & { credentials?: AwsTranscribeV1Credentials };
};

export type AwsTranscribeV1Node = AwsTranscribeV1ParamsNode;