import type { PostureCheckType } from '../../shared/services/mock-data.service';

/** Display metadata for one posture-check type in the Create form's TYPE select. */
export interface PostureCheckTypeMeta {
  value: PostureCheckType;
  label: string;
  description: string;
}

/**
 * Registry of selectable posture-check types, in dropdown order. The Create
 * form builds its TYPE options from this and dispatches per-type sub-forms on
 * the selected `value`.
 */
export const POSTURE_CHECK_TYPES: PostureCheckTypeMeta[] = [
  { value: 'OS',            label: 'OS Check',       description: 'Verify the operating system type and version on the device' },
  { value: 'MFA',           label: 'MFA Check',      description: 'Require multi-factor authentication before granting access' },
  { value: 'Process',       label: 'Process Check',  description: 'Ensure a specific process or application is running on the device' },
  { value: 'Domain',        label: 'Domain Check',   description: 'Verify the device is joined to a specific domain' },
  { value: 'MAC',           label: 'MAC Check',      description: 'Allow or deny access based on the device MAC address' },
  { value: 'WindowsDomain', label: 'Windows Domain', description: 'Verify the device is joined to a Windows Active Directory domain' },
  { value: 'ServiceProvider', label: 'Service Provider Check', description: 'Grant access based on device posture reported by an external provider such as CrowdStrike or Intune' },
];
