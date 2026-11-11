import { HttpRequest } from '@smithy/protocol-http';
import type { Request } from 'aws4';
import { type IHttpRequestMethods, type ICredentialTestRequest, type IHttpRequestOptions } from 'n8n-workflow';
import { type AWSRegion } from './regions';
import type { AwsCredentialsTypeBase, AwsAssumeRoleCredentialsType, AwsSecurityHeaders } from './types';
/**
 * AWS credentials test configuration for validating AWS credentials.
 * Uses the STS GetCallerIdentity action to verify that the provided credentials are valid.
 * Automatically handles both standard AWS regions and China regions with appropriate endpoints.
 */
export declare const awsCredentialsTest: ICredentialTestRequest;
/**
 * Ensures the region value belongs to the supported AWS regions list before it
 * is interpolated into request URLs or signing options. Anything outside the
 * known set is rejected with a controlled error.
 */
export declare function assertSupportedAwsRegion(region: unknown): asserts region is AWSRegion;
/**
 * Validates a user-supplied Bedrock endpoint override and returns the resolved URL.
 * Substitutes the `{region}` placeholder after the region itself is validated, and
 * requires an `http:`/`https:` scheme. The value is credential-holder-configured and
 * treated as trusted; no host allow-listing / SSRF check is applied on this path.
 *
 * @throws {UserError} When the region is unsupported, the URL is malformed, or the scheme is not http/https.
 */
export declare function validateBedrockEndpointOverride(override: string, region: AWSRegion): string;
/**
 * Shape of an AWS region label: a 2-4 letter partition prefix (`us`, `eusc`),
 * one or more word components, and a numeric suffix (`us-east-1`,
 * `us-gov-west-1`, `eusc-de-east-1`). Deliberately shape-only: a mistyped or
 * not-yet-supported region must reach the caller's validation instead of
 * being silently dropped.
 */
export declare const AWS_REGION_SHAPE_PATTERN: RegExp;
/**
 * Parses an AWS service URL to extract the service name and region.
 * Some AWS services are global and don't have a region. PrivateLink
 * endpoints (`vpce-<id>.<service>.<region>.vpce.amazonaws.com`) return their
 * positional service and region labels verbatim.
 *
 * On all other hostnames (public AWS endpoints, including dual-stack and
 * FIPS variants, and custom hosts) the region is the rightmost region-shaped
 * label, or null when no label matches. The service is the label right of
 * the region when the region is second-to-last on an AWS host (region-middle
 * and legacy region-first shapes: `<domain>.<region>.es`, `<region>.queue`);
 * otherwise the label left of the region (skipping a `dualstack` qualifier)
 * when qualifier labels such as a bucket name or API id precede it;
 * otherwise a trailing legacy region-less S3 service label (`<bucket>.s3`,
 * `<bucket>.s3-accelerate[.dualstack]`); otherwise the first label. Legacy
 * S3 shapes are special-cased: a region-shaped first label in front of
 * `s3`/`s3-accelerate` is a bucket name (null region), and dash-region
 * labels (`[<bucket>.]s3-<region>`) yield service `s3` with the embedded
 * region. The region is not validated against the supported region list;
 * callers must check it (e.g. with {@link assertSupportedAwsRegion}) before
 * using it for signing.
 *
 * @param url - The AWS service URL to parse
 * @returns Object containing the service name and region (null for global services)
 *
 * @see {@link https://docs.aws.amazon.com/general/latest/gr/rande.html#global-endpoints AWS Global Endpoints}
 */
export declare function parseAwsUrl(url: URL): {
    region: string | null;
    service: string;
};
/**
 * Applies AWS's S3 `UriEncode` canonicalization to a URL pathname: each segment is
 * decoded, then percent-encoded so that only RFC 3986 unreserved characters and the
 * `/` separators stay literal — the form S3 computes server-side when verifying
 * SigV4 signatures, and the form the AWS SDK sends on the wire. A segment that is
 * not valid percent-encoding (a stray `%`) is treated as raw text, so the key still
 * round-trips unchanged. An encoded slash collapses to `/` (S3 keys are flat, so
 * `%2F` and `/` address the same key — aws4 did the same). A literal `+` becomes
 * `%2B` (AWS SDK behavior); the legacy aws4 signer read a path `+` as a space.
 *
 * @param options.preserveEncodedSlashes - Keep encoded slashes in the wire URL.
 */
export declare function uriEncodeS3Pathname(pathname: string, options?: {
    preserveEncodedSlashes?: boolean;
}): string;
/**
 * Encodes the value of the S3 `x-amz-copy-source` header. CopyObject reads an
 * optional `?versionId=<id>` selector after the key, so the key is encoded as a
 * pathname and the selector is kept as written. Encoding the selector too would
 * make S3 read it as the last characters of the key.
 */
export declare function uriEncodeS3CopySource(copySource: string): string;
/**
 * Prepares AWS request options for signing by constructing the proper endpoint URL,
 * handling query parameters, and setting up the request body for AWS4 signature.
 *
 * This function handles multiple scenarios:
 * - Custom service endpoints from credentials
 * - Default AWS service endpoints
 * - URI-based requests (legacy IRequestOptions interface)
 * - Form data conversion to URL-encoded format
 * - Special handling for STS GetCallerIdentity requests
 *
 * @param requestOptions - The HTTP request options to modify
 * @param credentials - AWS credentials containing potential custom endpoints
 * @param path - The API path to append to the endpoint
 * @param method - HTTP method for the request
 * @param service - AWS service name (e.g., 's3', 'lambda', 'sts')
 * @param region - AWS region for the request
 * @returns Object containing signing options and the constructed endpoint URL
 */
export declare function awsGetSignInOptionsAndUpdateRequest(requestOptions: IHttpRequestOptions, credentials: AwsCredentialsTypeBase, path: string, method: string | undefined, service: string, region: AWSRegion): {
    signOpts: Request;
    url: string;
};
/**
 * Assumes an AWS IAM role via STS and returns temporary credentials.
 * Supports two master-credential modes: system credentials (env / IMDS / container)
 * or an explicitly provided STS key pair.
 *
 * @throws {UserError} When inputs fail validation or the STS AssumeRole call is rejected.
 * @see {@link https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html}
 */
export declare function assumeRole(credentials: AwsAssumeRoleCredentialsType, region: AWSRegion): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}>;
export declare function splitPathAndQuery(pathWithSearch: string): {
    path: string;
    query: Record<string, string | string[]>;
};
export declare function splitHostPort(host: string): {
    hostname: string;
    port: number | undefined;
};
export declare function buildSmithyHttpRequest(signOpts: Request, method?: IHttpRequestMethods): HttpRequest;
export declare function signOptions(requestOptions: IHttpRequestOptions, signOpts: Request, securityHeaders: AwsSecurityHeaders, url: string, method?: IHttpRequestMethods): Promise<IHttpRequestOptions>;
//# sourceMappingURL=utils.d.ts.map