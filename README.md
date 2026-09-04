# NF Console Redesign

A ground-up Angular 21 rebuild of the NetFoundry network-management console. Built as a new application (not a fork of the existing console) and organized as a feature-based structure under `src/lib`. The domain model — identities, services, policies, posture checks, routers, and sessions — maps to the OpenZiti/Ziti edge management model.

## Tech stack

- **Angular 21** (`^21.2.0`), Angular CLI `^21.2.11` — standalone components, component-based routing via `@angular/router`
- **No third-party UI library or CSS framework** — no Angular Material, PrimeNG, or Tailwind in the dependency set. UI is built from in-repo shared components with Angular's component-scoped styles.
- **Vitest** as the unit test runner (Angular 21 default)

## Getting started

```bash
npm install
npm start          # runs `ng serve` via the local CLI
```

Then open `http://localhost:4200/`.

> The Angular CLI is not assumed to be installed globally. Use `npm start` (or `npx ng serve`) so you run the CLI version pinned by this project rather than a global one.

## Project structure

```
src/
  app/
    app.routes.ts                 # all routes; every feature renders inside ConsoleShellComponent
  lib/
    shared/components/            # reusable UI primitives
      app-header/
      side-nav/
      console-shell/              # app layout shell (wraps all routed views)
      breadcrumb/
      confirm-dialog/
      empty-state/
      pill/
      toast/
      truncated-cell/
    features/                     # feature screens (see below)
```

## Features (routed surface)

`ConsoleShellComponent` provides the layout for all routes. `/` redirects to `/dashboard`.

| Feature | Routes |
| --- | --- |
| Dashboard | `/dashboard` |
| Identities | `/identities`, `/identities/new` |
| Services | `/services`, `/services/new` (type selector) → `/services/simple`, `/services/advanced` |
| Policies | `/policies`, `/policies/new` |
| Posture Checks | `/posture-checks`, `/posture-checks/new` |
| Routers | `/routers` |
| Sessions | `/sessions`, `/sessions/:id` (detail) |
| Metrics | `/metrics` → redirects to `/metrics/fabric-latency`; sub-pages: `overview`, `fabric-latency`, `controller-latency`, `latency-timeouts`, `traffic-analysis` |

Each Metrics page renders its own tab bar via `MetricsNavComponent`.

## Common commands

```bash
npm start                         # dev server (ng serve)
ng build                          # production build to dist/
ng test                           # unit tests (Vitest)
ng generate component <name>      # scaffold a component
```# nf-console-redesign
