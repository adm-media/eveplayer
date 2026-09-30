# Security Policy

## Supported versions

Security fixes are released for the current major line. When a new major is
published, the previous one receives critical security fixes for 6 months.

| Version | Supported |
|---------|-----------|
| `1.x` (latest) | ✅ |
| older majors | ⚠️ critical fixes for 6 months after the next major |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub private security advisories), or open
   <https://github.com/adm-media/eveplayer/security/advisories/new>.
2. If you can't use GitHub advisories, email **webmgr@adm-mediaconsulting.com** with
   the details.

Please include:

- affected version(s) and environment (browser / OS, bundler);
- a description of the issue and its impact;
- a minimal proof of concept or reproduction steps;
- any known mitigations.

## What to expect

- **Acknowledgement** within 5 business days.
- An initial assessment (severity, affected versions) within 10 business days.
- We'll keep you updated on remediation progress and coordinate a disclosure
  date with you.
- With your consent, we'll credit you in the release notes and the advisory.

## Scope

This library wraps [Video.js](https://videojs.com/) and
`@videojs/http-streaming`. Vulnerabilities in those upstream projects should be
reported to their respective maintainers; if the issue is in how this wrapper
uses them, report it here and we'll coordinate upstream as needed.

Out of scope: issues that require a malicious build environment, a compromised
dependency registry, or physical/local access to a user's machine.
