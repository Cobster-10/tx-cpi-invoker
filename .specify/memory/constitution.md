
<!--
Sync Impact Report
Version change: 1.x.x → 2.0.0
Modified principles:
- Library-First → Code Quality
- CLI Interface → Testing Standards
- Test-First → User Experience Consistency
- Integration Testing → Performance & Scalability
- Observability/Versioning/Simplicity → Security, Cross-Component Harmony
Added sections:
- Cross-Component Harmony
- Explicit Additional Constraints
- Explicit Development Workflow
Removed sections:
- Placeholder principle slots
Templates requiring updates:
- .specify/templates/plan-template.md ✅ updated
- .specify/templates/spec-template.md ✅ updated
- .specify/templates/tasks-template.md ✅ updated
Follow-up TODOs:
- Ratification date needs to be set (TODO)
- README.md: Add summary of principles and compliance reference (⚠ pending)
-->

# tx-cpi-invoker Constitution

## Core Principles

### I. Code Quality
Code MUST be clean, readable, maintainable, and simple. Avoid unnecessary complexity and over-engineering. All code must be documented and follow consistent style guides for each stack (Solana, frontend, backend).
Rationale: Ensures long-term maintainability and ease of onboarding.

### II. Testing Standards
All components MUST have unit, integration, and security tests. Tests must be automated and run on every change. No code is merged without passing all relevant tests.
Rationale: Guarantees reliability and reduces risk of regressions or vulnerabilities.

### III. User Experience Consistency
User experience MUST be unified and predictable across frontend, backend, and blockchain interactions. All user-facing flows must be tested for clarity and accessibility.
Rationale: Delivers a seamless experience and reduces user confusion.

### IV. Performance & Scalability
Solutions MUST be efficient and scalable. Avoid bottlenecks, hardcoded limits, and fragile dependencies. Performance targets must be defined and measured for all major features.
Rationale: Enables growth and robust operation under load.

### V. Security
Security MUST be prioritized in all design and implementation. Minimize attack vectors, validate inputs, and enforce secure coding practices. Regular audits and threat modeling are required.
Rationale: Protects users, assets, and reputation.

### VI. Cross-Component Harmony
No solution may degrade another component. If a change benefits one area but harms another, seek alternative approaches. All decisions must consider the full stack.
Rationale: Maintains project integrity and prevents siloed optimization.

## Additional Constraints
- Technology stack: Next.js, React, TypeScript, Tailwind CSS, Solana, Anchor (Rust), Codama-generated clients.
- Compliance: Adhere to best practices for blockchain, web, and backend security.
- Deployment: All deployments must pass security and performance checks.
- Documentation: All features and changes must be documented for both code and user flows.

## Development Workflow
- Code review is mandatory for all changes.
- All PRs must pass automated tests and constitution compliance checks.
- Deployment requires approval from at least one maintainer and must not violate any principle.
- Constitution compliance is checked at planning and review stages.

## Governance
The constitution supersedes all other practices. Amendments require documentation, approval, and a migration plan. All PRs and reviews must verify compliance. Versioning follows semantic rules: MAJOR for breaking changes, MINOR for new principles, PATCH for clarifications. Use README for runtime development guidance.

**Version**: 2.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date unknown | **Last Amended**: 2026-02-03
