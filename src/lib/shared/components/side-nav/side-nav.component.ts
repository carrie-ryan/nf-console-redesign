import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { UserPrefsService } from '../../services/user-prefs.service';

interface NavItem {
  label: string;
  subtitle: string;
  icon: string;
  path: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-side-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.css'
})
export class SideNavComponent {
  readonly prefs = inject(UserPrefsService);
  readonly navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', subtitle: 'Network overview', icon: 'fa-solid fa-gauge', path: '/dashboard' },
      ]
    },
    {
      label: 'Core Components',
      items: [
        { label: 'Identities',  subtitle: 'Devices & Users',            icon: 'fa-solid fa-users',           path: '/identities' },
        { label: 'Services',    subtitle: 'What to connect',            icon: 'fa-solid fa-server',          path: '/services' },
        { label: 'Routers',     subtitle: 'Network infrastructure',     icon: 'fa-solid fa-network-wired',   path: '/routers' },
      ]
    },
    {
      label: 'Access Management',
      items: [
        { label: 'Policies',       subtitle: 'Who can access what',   icon: 'fa-solid fa-shield-halved',  path: '/policies' },
        { label: 'Microsegments',  subtitle: 'Policy segment map',    icon: 'fa-solid fa-diagram-project', path: '/segments' },
        { label: 'Attribute Explorer', subtitle: 'Identities by role attribute', icon: 'fa-solid fa-circle-nodes', path: '/attribute-explorer' },
        { label: 'Posture Checks', subtitle: 'Device requirements',   icon: 'fa-solid fa-circle-check',   path: '/posture-checks' },
        { label: 'Authentication', subtitle: 'Auth methods',          icon: 'fa-solid fa-key',             path: '/authentication' },
        { label: 'Sessions',       subtitle: 'Active connections',    icon: 'fa-solid fa-wave-square',     path: '/sessions' },
        { label: 'External providers', subtitle: 'External systems',  icon: 'fa-solid fa-plug',            path: '/external-providers' },
      ]
    },
    {
      label: 'Visibility',
      items: [
        { label: 'Metrics',   subtitle: 'Latency & traffic',  icon: 'fa-solid fa-chart-bar',   path: '/metrics' },
        { label: 'Events',    subtitle: 'Network activity',   icon: 'fa-solid fa-bell',         path: '/events' },
        { label: 'Processes', subtitle: 'Provisioning logs',  icon: 'fa-solid fa-microchip',    path: '/processes' },
        { label: 'Alerts',    subtitle: 'Detector alerts',    icon: 'fa-solid fa-triangle-exclamation', path: '/alerts' },
      ]
    },
    {
      label: 'Infrastructure',
      items: [
        { label: 'Managed Components', subtitle: 'NetFoundry-hosted', icon: 'fa-solid fa-layer-group', path: '/managed-components' },
      ]
    },
    {
      label: 'Organization',
      items: [
        { label: 'Users', subtitle: 'Console access & roles', icon: 'fa-solid fa-user-gear', path: '/users' },
      ]
    }
  ];
}
