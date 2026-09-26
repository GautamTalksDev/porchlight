# Security policy

Porchlight handles calls for help and information about vulnerable people, so we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private vulnerability reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. We will acknowledge your report within three days and keep you updated until it is fixed.

## Scope

In scope: the protocol, the node agent and console, the city app and its API, the firmware, and the deployment configuration in this repository.

Out of scope: denial of service by radio jamming, and attacks that require physical possession of a beacon or a node's private key. These are documented as known limits.

## How we think about security

The threat model, our mapping to the OWASP Top 10:2025 and the OWASP Top 10 for LLM applications, and our known gaps are in [docs/SECURITY.md](docs/SECURITY.md).
