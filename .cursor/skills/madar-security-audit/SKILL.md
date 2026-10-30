---
name: madar-security-audit
description: Conduct read-only security and operational audits of Madar against its V1.5 guide and repository requirements. Use when the user asks for a Madar security review, implementation audit, or guide-to-source comparison.
disable-model-invocation: true
---

# Madar Security and Operational Audit

## Purpose

Assess the checked-out Madar implementation against the supplied V1.5 guide and repository requirements. Treat current source as evidence of behavior; documentation, tests, and requirements are not proof that a behavior is implemented.

Before auditing, read and apply `AGENTS.md` and `.opencode/skills/madar-erp-core-guidelines/SKILL.md`. These remain authoritative project rules and are not replaced by this skill.

## Default safety boundary

- Read-only unless the user explicitly expands scope. Do not edit project files, change permissions or configuration, upgrade dependencies, or access production data as an incidental audit step.
- Do not read `.env`, customer `storage/`, live databases, or `Backups/`. `.env.example` may be inspected; never reproduce secrets if encountered elsewhere.
- Do not run tests, builds, checks, `npm audit`, or other commands that execute project code or inspect dependency advisories unless the user explicitly authorizes them. Do not infer safety from the presence of tests.
- Do not use live data for verification. If validation is authorized, use temporary database and storage paths as required by `AGENTS.md`.
- Preserve the local-only data boundary. Do not upload customer information or add cloud services.
- Do not make a persistent report file inside the repository unless requested. If a requested Canvas or artifact cannot be created in an allowed location, provide the report in the conversation and explain the limitation.

## Audit workflow

1. **Establish scope.** Identify the requested release/guide, audit claims, relevant source paths, and explicit exclusions. Search for supplied guide and dependency-audit artifacts without opening secrets or customer data.
2. **Mark missing evidence.** If the V1.5 guide or advisory report is unavailable, say so early. Do not treat unattributed vulnerability counts as confirmed findings; request package names, locked versions, and advisory IDs for dependency mapping.
3. **Trace behavior in source.** Follow route middleware, role checks, request/response data, database writes and transactions, filesystem operations, configuration defaults, and relevant UI copy. Cite the narrowest useful file and line ranges. Use tests only as supporting evidence when authorized; tests do not establish production behavior by themselves.
4. **Compare against requirements.** Label each statement as one of: confirmed in current source; required by the supplied guide/repository instructions but not confirmed in source; conditional on deployment or policy; or unresolved. Never claim direct V1.5 compliance when the guide was not available.
5. **Assess impact and severity.** Explain the realistic preconditions, affected role/data/workflow, and user or business impact. Keep severity conditional when exploitability depends on deployment, role policy, external writers, or an unverified guide requirement.
6. **Report without changing state.** Separate findings from hardening suggestions and open questions. Include positive controls only when verified in source, and state the audit's limits explicitly.

## Finding format

Sort findings from highest to lowest severity. For each finding include:

- **ID and title**
- **Severity and confidence**
- **Evidence:** exact path and line range, plus the relevant source behavior
- **Impact / preconditions**
- **Recommended remediation**
- **Evidence status:** source-confirmed, guide-only requirement, conditional, or unresolved
- **V1.5 comparison status:** confirmed, contradicted, or unavailable

Do not combine a confirmed source fact with an unverified policy assumption. State the confirmed fact first, then identify the policy or deployment condition separately.

## Report structure

1. Executive summary and overall conclusion
2. Scope, method, and limitations
3. Findings ordered by severity
4. Positive controls confirmed in source
5. Hardening suggestions, separate from findings
6. Open questions and evidence needed to complete comparison

Use the user's language where practical. Keep the report concise but provide enough evidence for another reviewer to locate each behavior. Do not use a severity or advisory count as a substitute for explaining impact.

## Madar-specific review areas

Prioritize relevant areas rather than assuming every area is defective:

- Authentication, token/session revocation, role authorization, and first-run setup
- Generic file and thumbnail reads, storage path containment, symlinks, and client/order ownership
- Sensitive order, finance, employee, and internal-note fields in API responses and exports
- Invoice versus receipt/payment behavior; invoice balances and treasury transactions
- Whole-unit main warehouse stock, fractional offcuts, warehouse selection, and duplicate issue requests
- Soft deletion, audit actor/action/entity/old-new values, and filesystem/database failure ordering
- Backup consistency, retention, restore staging/journaling, and supervisor restart behavior
- Local-only storage and processing, configurable paths, and dependency compatibility where an authorized advisory report exists

For Arabic machine/folder matching, verify the actual schema and use `machines.name_ar` / Sequelize `nameAr`; constrain by area when supplied. For imports, check stable business codes, relation preservation, transactional behavior, and non-destructive handling of missing rows. Preserve archived originals; assess only derived export buffers for image compression. These are requirements to verify, not claims that the source implements them.

## Dependency review boundary

Do not run dependency scans by default. When the user supplies an audit report or authorizes a scan, map each advisory to the exact locked package/version, runtime or development reachability, affected code paths, and compatibility implications. Reconcile database-package recommendations with Madar's existing SQLite stack; do not silently switch drivers or recommend upgrades without verifying compatibility and scope.
