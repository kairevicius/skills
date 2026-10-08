# Role baselines — what the gaps measure against

A gap is a capability the subject's role family usually demonstrates in a
repository and this repository does not show. Without a baseline, "gaps" is a
list of whatever the author happened to think of; with one, it is a checklist a
reader can audit. `subject.role_family` selects the table; absent means
`software_engineering`.

How to use it in step 7 of the workflow:

1. Take the table for the subject's role family.
2. For each row, ask: does the git history show this? Look at directories,
   file types, and claims already drafted — not at intentions.
3. Rows with weak or no evidence become gaps, written as
   `<capability>: <what the history shows>` — for example
   `Database schema design: 3 touches on migrations in 9 months, none
   substantive.` Name the count you looked at; never soften ("limited
   exposure to…").
4. Rows with strong evidence are already claims. Rows that do not apply to the
   project at all (no database in a static-site repo) are neither: skip them and
   say so in `provenance.notes` if the omission could surprise a reader.

A row is a prompt, not a rule. Add a project-specific gap when the repository
makes one obvious (a CLI tool with no tests), and drop a row when the whole
project never needed the capability.

## software_engineering

| Capability | Where it shows in a repository |
|---|---|
| Type-system and module design | shared type packages, module boundaries, public interfaces |
| Testing discipline | test files added with features, regression tests, coverage of edge cases |
| Database and schema design | migrations, entity models, indexing, query shape |
| Backend service ownership | services, handlers, job processing, API contracts |
| Frontend and rendering | components, state management, rendering performance |
| Performance work | profiling-driven commits, measured improvements, caching |
| Security handling | authentication, authorization, input validation, secret handling |
| Infrastructure and deployment | CI workflows, containers, provisioning, release pipelines |
| Distributed and async systems | queues, webhooks, retries, idempotency, sync orchestration |
| Debugging and incident response | root-cause fixes with regression tests, post-incident hardening |

## data_and_ml

| Capability | Where it shows in a repository |
|---|---|
| Data modelling | schemas, feature definitions, dimensional models |
| Pipeline engineering | ETL/ELT jobs, orchestration, incremental loads |
| Data quality | validation rules, tests on data, monitoring of drift |
| Statistical rigour | evaluation code, baselines, significance handling |
| Model training and evaluation | training scripts, eval harnesses, metric tracking |
| Serving and deployment | inference services, batch scoring, model registries |
| Experiment tracking | reproducible configs, seeds, run manifests |
| Performance and cost | vectorisation, batching, resource limits |
| Documentation of analysis | notebooks turned into reports, decision records |

## design

| Capability | Where it shows in a repository |
|---|---|
| Design tokens and theming | token sources, theme files, colour and type scales |
| Component design in code | primitives, variants, composition patterns |
| Motion and interaction | animation code, easing, reduced-motion handling |
| Accessibility | contrast, focus order, ARIA, keyboard paths |
| Typography and layout | type scales, grids, responsive rules |
| Asset production | SVG/illustration sources, icon sets, export pipelines |
| Design documentation | Storybook or equivalent, usage guides, do/don't examples |
| Prototyping | throwaway branches, spike directories, demo routes |
| Design–engineering handoff | specs in the repo, annotated stories, review fixes |
| Brand application | marketing surfaces, templates, print or video assets |

## technical_writing

| Capability | Where it shows in a repository |
|---|---|
| Reference documentation | API references, configuration docs, generated-doc sources |
| Conceptual guides | architecture explanations, tutorials, onboarding paths |
| Information architecture | navigation structure, section reorganisation, cross-linking |
| Style and terminology | style guides, glossaries, consistent term use across files |
| Docs tooling | doc build configs, linting, link checking, generators |
| Code samples | runnable, tested examples kept in sync with the code |
| Localisation readiness | string externalisation, translation files, locale rules |
| Release communication | changelogs, release notes, migration guides |

## platform_and_operations

| Capability | Where it shows in a repository |
|---|---|
| CI/CD pipelines | workflow definitions, caching, gate design |
| Infrastructure as code | provisioning, environment definitions, secrets management |
| Containers and runtime | Dockerfiles, orchestration manifests, base images |
| Observability | logging, metrics, tracing, alert definitions |
| Reliability engineering | health checks, rollbacks, runbooks, incident fixes |
| Security posture | dependency policy, scanning, access control |
| Cost and capacity | resource sizing, autoscaling rules, budget alerts |
| Developer tooling | scripts, local setup, bootstrap paths |
| Release management | versioning, tagging, deployment scripts |

## product_management

| Capability | Where it shows in a repository |
|---|---|
| Specifications | specs, PRDs, acceptance criteria kept in the tree |
| Decision records | ADRs, rationale documents, trade-off write-ups |
| Prioritisation artefacts | roadmaps, milestone definitions, scope cuts |
| Analytics and instrumentation | event definitions, tracking plans, dashboards as code |
| Customer research | interview notes, segment definitions, persona documents |
| Copy and messaging | in-product copy, onboarding text, naming decisions |
| Release coordination | changelogs, launch checklists, communication drafts |
| Prototyping | clickable demos, spike code, experiment flags |

## research

| Capability | Where it shows in a repository |
|---|---|
| Experiment design | protocols, hypotheses, controls written down |
| Reproducibility | seeds, pinned environments, run manifests |
| Data handling | collection scripts, cleaning, provenance tracking |
| Analysis code | statistics, evaluation, plots generated from code |
| Literature grounding | references, comparisons to prior work |
| Writing | reports, papers, decision memos in the tree |
| Tooling | shared utilities, benchmarks, harnesses |
| Review and critique | commented analyses, replication attempts |

## other

No fixed table. Write the baseline the reader would expect for the role the
subject claims, in `provenance.notes`, then measure the gaps against it.
