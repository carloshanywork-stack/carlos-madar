import type { Resolvers } from './system-credentials-utils';
/**
 * SDK-backed implementations of the AWS system-credential sources. Each source is
 * resolved by the *specific* AWS SDK provider that mirrors today's hand-rolled
 * resolver. We deliberately compose them with our own ordered chain in
 * `getSystemCredentials()` (see `system-credentials-utils.ts`) and never use the
 * SDK's `fromNodeProviderChain`/`defaultProvider` "find credentials anywhere"
 * helpers, which would bypass the `awsSystemCredentialsAccess` gate and the
 * source allow-list.
 *
 * Each resolver destructures only the single provider it uses at its own
 * `await import`: the SDK is lazy-loaded (kept out of startup for non-AWS
 * workflows), and the `no-aws-credential-discovery-imports` lint rule (ENT-62)
 * only allows a fully-named selection, none of which are the banned
 * aggregate-discovery helpers.
 */
type SystemCredentials = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
};
/**
 * Whether a given source should resolve through the AWS SDK. Reads the
 * transitional `awsSystemCredentialsSdkSources` flag: `all`/empty → SDK for every
 * source, `none` → legacy for every source, otherwise a comma-separated allow-list.
 */
export declare function usesSdk(resolver: Resolvers): boolean;
/** Environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN). */
export declare function resolveEnvironmentViaSdk(): Promise<SystemCredentials | null>;
/** EKS IRSA web-identity (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE → STS). */
export declare function resolveWebIdentityViaSdk(region?: string): Promise<SystemCredentials | null>;
/** EKS Pod Identity (AWS_CONTAINER_CREDENTIALS_FULL_URI + token). */
export declare function resolvePodIdentityViaSdk(): Promise<SystemCredentials | null>;
/** ECS / Fargate task role (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI). */
export declare function resolveContainerMetadataViaSdk(): Promise<SystemCredentials | null>;
/** EC2 instance metadata service (IMDS). */
export declare function resolveInstanceMetadataViaSdk(): Promise<SystemCredentials | null>;
export {};
//# sourceMappingURL=system-credentials-sdk.d.ts.map