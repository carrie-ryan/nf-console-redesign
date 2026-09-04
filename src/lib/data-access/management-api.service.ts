import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Tier 2 / REST dialect — the V3 management API (apiv2).
 *
 * These are the flat, HATEOAS-style CRUD collections at /core/v3/*. We call
 * them through NAMED wrappers (one method per resource collection) rather
 * than a generic getPage()/getResource(): the named method owns the path,
 * the query-param shape, and eventually the response typing, so callers never
 * hand-assemble a HATEOAS URL or chase _links by hand.
 *
 * Relative paths only ('/core/...') so the dev-server proxy forwards to the
 * staging gateway and the auth interceptor attaches the bearer.
 */
@Injectable({ providedIn: 'root' })
export class ManagementApiService {
  private readonly http = inject(HttpClient);

  /**
   * List endpoints for a specific network — matches the working cloud-ziti
   * client (EndpointServiceV2 → ngx-hateoas-client) exactly:
   *   GET /core/v3/endpoints?networkId=<id>&page=0&size=10&sort=name,asc
   *   Accept: application/hal+json
   *
   * The netfoundry-ui audit confirmed this flat collection + `networkId` query
   * param is the correct scoping (NOT a network-scoped path), and that the
   * hal+json Accept header is required — a bare application/json request is
   * what produced the earlier 404 "lacks authorization".
   */
  getEndpointPage(
    networkId: string,
    opts: { page?: number; size?: number; sort?: string } = {},
  ): Observable<unknown> {
    const httpParams = new HttpParams()
      .set('networkId', networkId)
      .set('page', String(opts.page ?? 0))
      .set('size', String(opts.size ?? 10))
      .set('sort', opts.sort ?? 'name,asc');

    const path = '/core/v3/endpoints';
    console.log(
      '[management-api] getEndpointPage final URL:',
      `${path}?${httpParams.toString()}`,
    );

    return this.http
      .get<unknown>(path, {
        params: httpParams,
        headers: new HttpHeaders({ Accept: 'application/hal+json' }),
      })
      .pipe(
        tap((res) =>
          console.log(
            '[management-api] RAW /core/v3/endpoints (getEndpointPage):',
            res,
          ),
        ),
      );
  }
}
