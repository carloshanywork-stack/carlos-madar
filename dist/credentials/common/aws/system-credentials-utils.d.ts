import { type AWSRegion } from './regions';
export type Resolvers = 'environment' | 'roleForServiceAccount' | 'podIdentity' | 'containerMetadata' | 'instanceMetadata';
type ReturnData = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
};
export declare const envGetter: (key: string) => string | undefined;
export declare const credentialsResolver: Record<Exclude<Resolvers, 'roleForServiceAccount'>, () => Promise<ReturnData | null>>;
/**
 * Retrieves AWS credentials from various system sources following the AWS credential chain.
 * Attempts to get credentials in the following order:
 * 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
 * 2. IAM Role for Service Account (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE)
 * 3. EKS Pod Identity (AWS_CONTAINER_CREDENTIALS_FULL_URI)
 * 4. ECS/Fargate container metadata (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
 * 5. EC2 instance metadata service
 */
export declare function getSystemCredentials(region: AWSRegion): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    source: Resolvers;
} | null>;
/**
 * Retrieves AWS credentials by assuming a role via OIDC web identity (IRSA).
 * Used when running in EKS with IAM Roles for Service Accounts configured.
 * Reads the OIDC token from the file at AWS_WEB_IDENTITY_TOKEN_FILE and calls
 * STS AssumeRoleWithWebIdentity to exchange it for temporary credentials.
 *
 * @returns Promise resolving to credentials object or null if IRSA is not configured
 *
 * @see {@link https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html IRSA}
 * @see {@link https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html STS API}
 * @see {@link https://github.com/aws/aws-sdk-js-v3/blob/main/packages-internal/credential-provider-web-identity/src/fromWebToken.ts AWS SDK v3 implementation}
 */
export declare function getRoleForServiceAccountCredentials(region: AWSRegion): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
} | {
    accessKeyId: any;
    secretAccessKey: any;
    sessionToken: any;
} | null>;
export {};
//# sourceMappingURL=system-credentials-utils.d.ts.map