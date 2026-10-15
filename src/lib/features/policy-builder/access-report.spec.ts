/**
 * Access report: one row per authorized (identity, service, direction), from LIVE, with
 * granting policies (by name or the matched rule), their required checks, and status as
 * observed; exported as CSV with a header block, in chunks with progress.
 *
 * Run `npx ng test --watch=false --include src/lib/features/policy-builder/access-report.spec.ts`
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buildSeedWorld } from '../authorization/trifecta-world.adapter';
import { resolve, type TrifectaWorld } from '../authorization/trifecta-resolver';
import { AccessReportExporter } from './access-report.exporter';
import { CSV_COLUMNS, configurationLine, accessReport, accessReportAsync, accessReportCsv, type ReportScope } from './access-report';
import { PolicyDraftStore } from './draft/policy-draft.store';
import { ServiceListComponent } from './service-list.component';
import { IdentityViewComponent } from './identity-view.component';

const seed = buildSeedWorld();
const GIT_REPO = 'svc-004';
const BOB = 'id-015';

/** The resolver's authorized pairs in scope (as a sorted set — the report's own order is tested apart). */
function expectedPairs(world: TrifectaWorld, scope: ReportScope) {
  const services = scope.kind === 'services' ? world.services.filter((s) => scope.ids.includes(s.id)) : world.services;
  const identities = scope.kind === 'identities' ? world.identities.filter((i) => scope.ids.includes(i.id)) : world.identities;
  return services
    .flatMap((s) =>
      identities.flatMap((i) => {
        const pair = resolve(i.id, s.id, world);
        return [
          ...(pair.dial.authorized ? [`${i.id}|${s.id}|Dial|${pair.dial.viaPolicies.join('+')}`] : []),
          ...(pair.bind.authorized ? [`${i.id}|${s.id}|Bind|${pair.bind.viaPolicies.join('+')}`] : []),
        ];
      }),
    )
    .sort();
}
const keys = (world: TrifectaWorld, scope: ReportScope) =>
  accessReport(world, scope)
    .map((r) => `${r.identityId}|${r.serviceId}|${r.direction}|${r.grants.map((g) => g.policyId).join('+')}`)
    .sort();

describe('accessReport', () => {
  const scopes: [string, ReportScope][] = [
    ['all', { kind: 'all' }],
    ['git-repo', { kind: 'services', ids: [GIT_REPO] }],
    ['git-repo + api-prod', { kind: 'services', ids: [GIT_REPO, 'svc-005'] }],
    ['bob', { kind: 'identities', ids: [BOB] }],
    ['alice + server-build-01', { kind: 'identities', ids: ['id-004', seed.identities.find((i) => i.name === 'server-build-01')!.id] }],
  ];

  for (const [name, scope] of scopes) {
    it(`rows equal the resolver's authorized pairs — ${name}`, () => {
      const expected = expectedPairs(seed, scope);
      expect(expected.length).toBeGreaterThan(0);
      expect(keys(seed, scope)).toEqual(expected);
    });
  }

  it("bob's git-repo Dial row: both granting policies, require-mfa on admins-dev-access only", () => {
    const row = accessReport(seed, { kind: 'services', ids: [GIT_REPO] }).find((r) => r.identityId === BOB && r.direction === 'Dial')!;
    expect(row).toMatchObject({ identityName: 'bob@corp.com', identityAttributes: ['#admins', '#users'], serviceName: 'git-repo' });
    expect(row.grants).toEqual([
      { policyId: 'pol-001', policyName: 'admins-dev-access', by: 'rule', match: '#admins', requiredChecks: ['require-mfa'] },
      { policyId: 'pol-002', policyName: 'users-gitlab', by: 'rule', match: '#users', requiredChecks: [] },
    ]);
    expect(['can connect', "authorized, can't connect"]).toContain(row.status);
  });

  it("bob's git-repo row: require-mfa bypassed via users-gitlab, as the posture panel says", () => {
    const rows = accessReport(seed, { kind: 'services', ids: [GIT_REPO] });
    const bob = rows.find((r) => r.identityId === BOB && r.direction === 'Dial')!;
    expect(bob.bypassed).toEqual([{ checkName: 'require-mfa', viaPolicyName: 'users-gitlab' }]);
    expect(rows.find((r) => r.identityName === 'laptop-alice')!.bypassed).toEqual([]);
  });

  it('Bind rows: active, standby, not serving or can\'t host — server-prod-01 on git-repo is not serving', () => {
    const rows = accessReport(seed, { kind: 'services', ids: [GIT_REPO] }).filter((r) => r.direction === 'Bind');
    const status = (name: string) => rows.find((r) => r.identityName === name)!;
    expect(status('server-prod-01')).toMatchObject({ status: 'authorized, not serving', reason: null });
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['active host', 'authorized, not serving']));
    for (const r of rows) expect(['active host', 'standby host', 'authorized, not serving', "authorized, can't host"]).toContain(r.status);
    // Dial rows keep their two statuses.
    const dial = accessReport(seed, { kind: 'all' }).filter((r) => r.direction === 'Dial');
    for (const r of dial) expect(['can connect', "authorized, can't connect"]).toContain(r.status);
  });

  it('sorted: service A–Z, then Dial before Bind, then identity A–Z', () => {
    for (const scope of [{ kind: 'all' }, { kind: 'identities', ids: [BOB, 'id-004'] }] as ReportScope[]) {
      const rows = accessReport(seed, scope);
      const sorted = [...rows].sort(
        (a, b) =>
          a.serviceName.localeCompare(b.serviceName, 'en') ||
          (a.direction === b.direction ? 0 : a.direction === 'Dial' ? -1 : 1) ||
          a.identityName.localeCompare(b.identityName, 'en'),
      );
      expect(rows).toEqual(sorted);
    }
    const git = accessReport(seed, { kind: 'services', ids: [GIT_REPO] });
    expect(git[0]).toMatchObject({ direction: 'Dial', identityName: 'alice@corp.com' });
    expect(git.findIndex((r) => r.direction === 'Bind')).toBe(git.filter((r) => r.direction === 'Dial').length);
  });

  it('a named host is "by name"; a status that fails says why', () => {
    const rows = accessReport(seed, { kind: 'services', ids: [GIT_REPO] });
    const host = rows.find((r) => r.identityName === 'server-build-01' && r.direction === 'Bind')!;
    expect(host.grants.find((g) => g.policyName === 'git-repo-hosts')!.match).toBe('by name');
    const offline = accessReport(seed, { kind: 'services', ids: ['svc-006'] }).find((r) => r.direction === 'Dial')!;
    expect(offline).toMatchObject({ status: "authorized, can't connect", reason: 'routers offline' });
  });

  it('the chunked run gives the same rows, with progress per service', async () => {
    const progress: number[] = [];
    const rows = await accessReportAsync(seed, { kind: 'all' }, (p) => progress.push(p.done));
    expect(rows).toEqual(accessReport(seed, { kind: 'all' }));
    expect(progress.at(-1)).toBe(seed.services.length);
  });

  it('CSV: header block, columns, one line per row; cells quoted where needed', () => {
    const rows = accessReport(seed, { kind: 'services', ids: [GIT_REPO] });
    const csv = accessReportCsv(rows, {
      generatedAt: '2026-10-09T15:00:00.000Z',
      network: 'corp-prod',
      configuration: configurationLine({ id: 'c-2', at: '2026-10-09T14:58:00.000Z' }),
      scope: 'Services: git-repo',
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines.slice(0, 6)).toEqual([
      '# Access report',
      '# Generated at: 2026-10-09T15:00:00.000Z',
      '# Network: corp-prod',
      '# Configuration as of c-2 (2026-10-09T14:58:00.000Z)',
      '# Scope: Services: git-repo',
      `# Rows: ${rows.length}`,
    ]);
    expect(lines[6]).toMatch(/^# Status is as observed at generation time/);
    expect(lines[7]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(8 + rows.length);
    expect(lines.find((l) => l.startsWith('bob@corp.com,') && l.includes(',Dial,'))).toBe(
      'bob@corp.com,#admins #users,git-repo,Dial,admins-dev-access; users-gitlab,#admins; #users,require-mfa; none,can connect,,require-mfa (via users-gitlab)',
    );
    expect(lines.find((l) => l.startsWith('server-prod-01,'))).toBe(
      'server-prod-01,#servers #prod,git-repo,Bind,git-repo-hosts,"all of #servers, #prod",none,"authorized, not serving",,',
    );
    expect(configurationLine(null)).toBe('Configuration: no commits this session');
  });
});

describe('export', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const body = (csv: string) => csv.split('\n').filter((l) => !l.startsWith('# Generated at') && !l.startsWith('# Status is'));

  it('a pending draft does not change the report', async () => {
    const exporter = TestBed.inject(AccessReportExporter);
    const store = TestBed.inject(PolicyDraftStore);
    const before = (await exporter.export('t', { kind: 'all' }, 'all'))!;
    store.upsertUpdate('pol-002', { identityRoles: ['#nobody'] }); // users lose git services in the draft
    store.createForService('bind', GIT_REPO);
    expect(store.ops().length).toBe(2);
    const after = (await exporter.export('t', { kind: 'all' }, 'all'))!;
    expect(body(after.csv)).toEqual(body(before.csv));
    expect(after.rows).toBe(accessReport(store.live(), { kind: 'all' }).length);
    expect(after.csv).toContain('# Network: corp-prod');
    expect(after.csv).toContain('# Scope: All services');
    expect(after.csv).toContain('# Configuration: no commits this session');
    store.commit();
    const committed = (await exporter.export('t', { kind: 'all' }, 'all'))!;
    expect(committed.csv).toContain(`# Configuration as of c-1 (${store.history()[0].at})`);
  });

  it('service list: the button exports all, or the filtered services', async () => {
    const fixture = TestBed.createComponent(ServiceListComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const exporter = TestBed.inject(AccessReportExporter);
    el.querySelector<HTMLButtonElement>('.er-btn')!.click();
    await vi.waitFor(() => expect(exporter.last()).not.toBeNull());
    expect(exporter.last()!.scope).toBe('All services');
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'git-repo';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.er-btn')!.click();
    await vi.waitFor(() => expect(exporter.last()!.scope).toBe('Services: git-repo'));
  });

  it('identity lens: the button exports that identity', async () => {
    const fixture = TestBed.createComponent(IdentityViewComponent);
    fixture.componentRef.setInput('identityId', BOB);
    fixture.detectChanges();
    const exporter = TestBed.inject(AccessReportExporter);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.er-btn')!.click();
    await vi.waitFor(() => expect(exporter.last()).not.toBeNull());
    expect(exporter.last()!.scope).toBe('Identities: bob@corp.com');
    expect(exporter.last()!.rows).toBe(expectedPairs(seed, { kind: 'identities', ids: [BOB] }).length);
  });
});
