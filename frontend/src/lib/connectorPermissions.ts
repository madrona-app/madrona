/**
 * Connector configuration field classification and permission utilities.
 * 
 * Determines what fields org admins can edit based on field type.
 * 
 * Field Classification:
 * - EDITABLE: Display name, description, notes (always editable)
 * - OPERATIONAL: Non-destructive settings like timeout, retries (editable with confirmation)
 * - LOCKED: Credentials, schema mappings, transformation logic (never editable)
 */

/**
 * Classify a connector config field as editable, operational, or locked.
 */
export function classifyConnectorField(fieldKey: string, _fieldSchema?: any): 'editable' | 'operational' | 'locked' {
  const lowerKey = fieldKey.toLowerCase();
  
  // Always-editable metadata fields
  if (lowerKey === 'name' || lowerKey === 'display_name' || 
      lowerKey === 'description' || lowerKey === 'notes') {
    return 'editable';
  }
  
  // Locked fields: credentials and auth
  if (lowerKey.includes('key') || 
      lowerKey.includes('token') || 
      lowerKey.includes('secret') || 
      lowerKey.includes('password') || 
      lowerKey.includes('credential') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('service_account')) {
    return 'locked';
  }
  
  // Locked fields: schema and mapping configurations
  if (lowerKey.includes('schema') || 
      lowerKey.includes('mapping') || 
      lowerKey.includes('transform') ||
      lowerKey.includes('field_map')) {
    return 'locked';
  }
  
  // Locked fields: connector identity
  if (lowerKey === 'type' || 
      lowerKey === 'connector_type' || 
      lowerKey === 'implementation') {
    return 'locked';
  }
  
  // Operational settings: potentially adjustable with care
  if (lowerKey.includes('timeout') || 
      lowerKey.includes('retry') || 
      lowerKey.includes('batch') ||
      lowerKey.includes('limit') ||
      lowerKey.includes('page_size') ||
      lowerKey.includes('concurrent')) {
    return 'operational';
  }
  
  // Default to operational for unknown fields (safer than editable)
  return 'operational';
}

/**
 * Check if a user can edit connector settings.
 */
export function canEditConnectorSettings(hasPermission: boolean): {
  canEditMetadata: boolean;
  canEditOperational: boolean;
  canEditCredentials: boolean;
  lockReason?: string;
} {
  // No permission = can't edit anything
  if (!hasPermission) {
    return {
      canEditMetadata: false,
      canEditOperational: false,
      canEditCredentials: false,
      lockReason: 'You do not have permission to edit connector settings. Contact an organization administrator.',
    };
  }
  
  // Org admins can edit metadata and operational settings, never credentials.
  return {
    canEditMetadata: true,
    canEditOperational: true,
    canEditCredentials: false,
    lockReason: 'Authentication credentials and schema mappings cannot be modified. Contact support if changes are required.',
  };
}

/**
 * Get user-friendly explanation for why a field is locked.
 */
export function getFieldLockReason(
  fieldType: 'editable' | 'operational' | 'locked',
  hasPermission: boolean
): string | null {
  if (!hasPermission) {
    return 'You do not have permission to edit connector settings.';
  }
  
  if (fieldType === 'locked') {
    return 'Authentication credentials, schema mappings, and transformation logic cannot be modified to prevent breaking integrations.';
  }
  
  return null;
}
