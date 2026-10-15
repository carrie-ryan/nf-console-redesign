import { Component } from '@angular/core';
import { GroupedRosterViewComponent } from '../discovery/grouped-roster-view.component';

/** Standalone /attribute-explorer page — hosts the grouped roster view
 *  (identities by role attribute) under Access Management. */
@Component({
  selector: 'app-attribute-explorer',
  standalone: true,
  imports: [GroupedRosterViewComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Attribute Explorer</h1>
        <p>Identities by role attribute</p>
      </div>
    </div>

    <app-grouped-roster-view />
  `,
})
export class AttributeExplorerComponent {}
