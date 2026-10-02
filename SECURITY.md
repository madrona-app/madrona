# Security Policy

## Reporting a vulnerability

Please report security issues privately, not as a public GitHub issue.

Use [GitHub's private vulnerability reporting](https://github.com/madrona-app/madrona/security/advisories/new)
on this repository. That opens a private advisory visible only to the
maintainers.

Please include:

- what the issue is, and which component it affects;
- the steps to reproduce it, or the code path you traced;
- what an attacker gains — the practical impact, not only the mechanism.

You will get an acknowledgement within a few working days. Madrona is
maintained by a small team, so please allow reasonable time for a fix before
disclosing publicly.

## What we consider in scope

Madrona is a multi-tenant collections management platform. Reports touching
these are especially valuable:

- **Tenant isolation** — any path where one organization can read or modify
  another's records, including through row-level security policies, admin
  (BYPASSRLS) sessions, or foreign keys between org-scoped tables.
- **Authorization** — a role, API key scope, or approval gate that can be
  bypassed or escalated, including within a single organization.
- **Culturally sensitive material** — anything that publishes or exposes
  records whose access is restricted, particularly NAGPRA display and access
  gating (43 CFR 10).
- **Record integrity** — silent destruction of collection data, or a way to
  alter the audit trail or attribution of a record.
- **Authentication and session handling.**

## Out of scope

- Findings against a deployment you do not operate or have permission to test.
- Vulnerabilities in third-party dependencies with no Madrona-specific impact —
  please report those upstream; tell us if Madrona's usage makes them
  exploitable here.
- Missing hardening headers or configuration recommendations with no
  demonstrated impact.
- Reports produced solely by an automated scanner, without a traced code path.

## Deployment note

Madrona is self-hostable. Some controls are the operator's: the database role
split (the application must connect as the `NOBYPASSRLS` role), TLS
termination, and the trusted-proxy configuration that makes client IPs
trustworthy. Misconfiguration of these in your own deployment is not a
vulnerability in the project, but if our defaults or documentation invite the
mistake, we want to hear about it — that we do consider a bug.
