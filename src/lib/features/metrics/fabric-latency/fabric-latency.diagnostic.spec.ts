import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { FabricLatencyComponent } from './fabric-latency.component';
import { TemplateSearchService } from '../../../data-access/template-search.service';

/**
 * DIAGNOSTIC (temporary) — exercises the component in the service's default
 * fixture mode (no network) to see what the data pipeline actually produces
 * and which branch the chart getters return.
 */
describe('FabricLatencyComponent fixture-mode diagnostic', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FabricLatencyComponent],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
  });

  it('reports parsed series and getter branch', async () => {
    const svc = TestBed.inject(TemplateSearchService);
    const fixture = TestBed.createComponent(FabricLatencyComponent);
    const cmp = fixture.componentInstance;

    fixture.detectChanges(); // triggers ngOnInit + first render (reads getters)
    await fixture.whenStable();

    // Snapshot everything the diagnostic asks for into one object so a mismatch
    // prints the FULL actual picture as a diff.
    const diag = {
      mode: svc.mode,
      useServiceData: cmp.useServiceData,
      serviceLink1First3: cmp.serviceLink1()?.slice(0, 3) ?? null,
      serviceLink2First3: cmp.serviceLink2()?.slice(0, 3) ?? null,
      chartLink1First3: cmp.chartLink1.slice(0, 3),
      chartLink2First3: cmp.chartLink2.slice(0, 3),
      chartLink1Length: cmp.chartLink1.length,
      chartLink1IsMock: cmp.chartLink1 === cmp.link1,
      chartLink2IsMock: cmp.chartLink2 === cmp.link2,
      mockLink1First3: cmp.link1.slice(0, 3),
    };

    // Asserting the values I EXPECT if the fixture pipeline works end-to-end.
    // A pass affirmatively confirms each fact; a fail prints actual vs expected.
    expect(diag).toEqual({
      mode: 'fixture',
      useServiceData: true,
      serviceLink1First3: [7.2, 7.1, 6.9],
      serviceLink2First3: [5.4, 5.6, 5.2],
      chartLink1First3: [7.2, 7.1, 6.9],
      chartLink2First3: [5.4, 5.6, 5.2],
      chartLink1Length: 25,
      chartLink1IsMock: false,
      chartLink2IsMock: false,
      mockLink1First3: [10, 10, 10],
    });
  });
});
