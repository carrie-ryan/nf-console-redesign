import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.local';

/**
 * PHASE 0.5 DIAGNOSTIC — temporary. Wired via provideAppInitializer.
 *
 * Makes one authenticated GET /core/v3/networks (relative, so the dev-server
 * proxy forwards it to the staging gateway and CORS is a non-issue) and logs
 * each network's id + networkGroupId to the browser console. Copy those two
 * values into environment.local.ts, then this probe can be removed.
 *
 * Doubles as the auth proof for the /core (Tier 2) dialect: a 200 here means
 * the token authenticates against the V3 management API.
 */
export function networkIdProbe(): void {
  const http = inject(HttpClient);

  if (!environment.auth0Token) {
    console.warn(
      '[network-id-probe] environment.local.ts has no auth0Token — skipping /core/v3/networks probe. ' +
        'Paste your staging Auth0 bearer and reload.',
    );
    return;
  }

  // size=100 to page in everything on the group in one shot for a POC-sized account.
  http.get<any>('/core/v3/networks', { params: { size: '100' } }).subscribe({
    next: (res: any) => {
      console.log('[network-id-probe] RAW /core/v3/networks response:', res);

      const networks: any[] =
        res?._embedded?.networkList ??
        res?._embedded?.networks ??
        res?.content ??
        (Array.isArray(res) ? res : []);

      if (!networks.length) {
        console.warn(
          '[network-id-probe] Got a 200 but found no network array at the expected paths. ' +
            'Inspect the RAW response above and tell me its shape.',
        );
        return;
      }

      console.log(`[network-id-probe] Found ${networks.length} network(s):`);
      networks.forEach((n: any) => {
        // networkGroupId may be a flat field or a HATEOAS link relation, depending on the resource.
        const groupId =
          n?.networkGroupId ??
          n?.networkGroup?.id ??
          n?._links?.networkGroup?.href ??
          '(networkGroupId not on this object — check RAW response)';
        console.log(
          `  • name="${n?.name}"  networkId=${n?.id}  networkGroupId=${groupId}`,
        );
      });
      console.log(
        '[network-id-probe] Copy the networkId + networkGroupId of your target network into environment.local.ts.',
      );
    },
    error: (err) => {
      console.error(
        '[network-id-probe] GET /core/v3/networks FAILED. Status:',
        err?.status,
        err,
      );
      if (err?.status === 401 || err?.status === 403) {
        console.error(
          '[network-id-probe] Auth rejected — token is missing/expired/wrong-env, or wrong audience. ' +
            'This is the go/no-go signal for the /core dialect.',
        );
      }
    },
  });
}
