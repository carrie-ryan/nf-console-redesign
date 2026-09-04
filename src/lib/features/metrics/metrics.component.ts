// MetricsComponent is no longer used as a route component.
// Each metrics sub-page (fabric-latency, controller-latency, etc.) is a direct
// flat child route of ConsoleShellComponent and owns its own MetricsNavComponent.
import { Component } from '@angular/core';

@Component({ selector: 'app-metrics', standalone: true, imports: [], template: '' })
export class MetricsComponent {}
