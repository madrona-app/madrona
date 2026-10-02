import { describe, it, expect } from 'vitest';
import {
  classifyConnectorField,
  canEditConnectorSettings,
  getFieldLockReason,
} from '../../lib/connectorPermissions';

describe('connectorPermissions', () => {
  describe('classifyConnectorField', () => {
    describe('editable fields', () => {
      it('classifies "name" as editable', () => {
        expect(classifyConnectorField('name')).toBe('editable');
      });

      it('classifies "display_name" as editable', () => {
        expect(classifyConnectorField('display_name')).toBe('editable');
      });

      it('classifies "description" as editable', () => {
        expect(classifyConnectorField('description')).toBe('editable');
      });

      it('classifies "notes" as editable', () => {
        expect(classifyConnectorField('notes')).toBe('editable');
      });

      it('handles case-insensitive matching for editable fields', () => {
        expect(classifyConnectorField('NAME')).toBe('editable');
        expect(classifyConnectorField('Description')).toBe('editable');
        expect(classifyConnectorField('NOTES')).toBe('editable');
      });
    });

    describe('locked fields - credentials', () => {
      it('classifies fields with "key" as locked', () => {
        expect(classifyConnectorField('api_key')).toBe('locked');
        expect(classifyConnectorField('access_key')).toBe('locked');
      });

      it('classifies fields with "token" as locked', () => {
        expect(classifyConnectorField('access_token')).toBe('locked');
        expect(classifyConnectorField('refresh_token')).toBe('locked');
      });

      it('classifies fields with "secret" as locked', () => {
        expect(classifyConnectorField('client_secret')).toBe('locked');
        expect(classifyConnectorField('secret_key')).toBe('locked');
      });

      it('classifies fields with "password" as locked', () => {
        expect(classifyConnectorField('password')).toBe('locked');
        expect(classifyConnectorField('db_password')).toBe('locked');
      });

      it('classifies fields with "credential" as locked', () => {
        expect(classifyConnectorField('credentials')).toBe('locked');
        expect(classifyConnectorField('user_credential')).toBe('locked');
      });

      it('classifies fields with "auth" as locked', () => {
        expect(classifyConnectorField('auth_config')).toBe('locked');
        expect(classifyConnectorField('authentication')).toBe('locked');
      });

      it('classifies fields with "service_account" as locked', () => {
        expect(classifyConnectorField('service_account')).toBe('locked');
        expect(classifyConnectorField('service_account_json')).toBe('locked');
      });
    });

    describe('locked fields - schema/mapping', () => {
      it('classifies fields with "schema" as locked', () => {
        expect(classifyConnectorField('schema')).toBe('locked');
        expect(classifyConnectorField('schema_config')).toBe('locked');
      });

      it('classifies fields with "mapping" as locked', () => {
        expect(classifyConnectorField('field_mapping')).toBe('locked');
        expect(classifyConnectorField('data_mapping')).toBe('locked');
      });

      it('classifies fields with "transform" as locked', () => {
        expect(classifyConnectorField('transform_config')).toBe('locked');
        expect(classifyConnectorField('data_transform')).toBe('locked');
      });

      it('classifies fields with "field_map" as locked', () => {
        expect(classifyConnectorField('field_map')).toBe('locked');
      });
    });

    describe('locked fields - connector identity', () => {
      it('classifies "type" as locked', () => {
        expect(classifyConnectorField('type')).toBe('locked');
      });

      it('classifies "connector_type" as locked', () => {
        expect(classifyConnectorField('connector_type')).toBe('locked');
      });

      it('classifies "implementation" as locked', () => {
        expect(classifyConnectorField('implementation')).toBe('locked');
      });
    });

    describe('operational fields', () => {
      it('classifies fields with "timeout" as operational', () => {
        expect(classifyConnectorField('timeout')).toBe('operational');
        expect(classifyConnectorField('connection_timeout')).toBe('operational');
      });

      it('classifies fields with "retry" as operational', () => {
        expect(classifyConnectorField('retry_count')).toBe('operational');
        expect(classifyConnectorField('max_retries')).toBe('operational');
      });

      it('classifies fields with "batch" as operational', () => {
        expect(classifyConnectorField('batch_size')).toBe('operational');
      });

      it('classifies fields with "limit" as operational', () => {
        expect(classifyConnectorField('rate_limit')).toBe('operational');
        expect(classifyConnectorField('request_limit')).toBe('operational');
      });

      it('classifies fields with "page_size" as operational', () => {
        expect(classifyConnectorField('page_size')).toBe('operational');
      });

      it('classifies fields with "concurrent" as operational', () => {
        expect(classifyConnectorField('concurrent_requests')).toBe('operational');
      });
    });

    describe('default classification', () => {
      it('classifies unknown fields as operational', () => {
        expect(classifyConnectorField('unknown_field')).toBe('operational');
        expect(classifyConnectorField('some_setting')).toBe('operational');
      });
    });
  });

  describe('canEditConnectorSettings', () => {
    it('returns all false when no permission', () => {
      const result = canEditConnectorSettings(false);

      expect(result.canEditMetadata).toBe(false);
      expect(result.canEditOperational).toBe(false);
      expect(result.canEditCredentials).toBe(false);
      expect(result.lockReason).toContain('do not have permission');
    });

    it('allows metadata and operational editing, never credentials', () => {
      const result = canEditConnectorSettings(true);

      expect(result.canEditMetadata).toBe(true);
      expect(result.canEditOperational).toBe(true);
      expect(result.canEditCredentials).toBe(false);
      expect(result.lockReason).toContain('Authentication credentials');
    });
  });

  describe('getFieldLockReason', () => {
    it('returns the permission message for every field type when no permission', () => {
      expect(getFieldLockReason('editable', false)).toContain('do not have permission');
      expect(getFieldLockReason('operational', false)).toContain('permission');
      expect(getFieldLockReason('locked', false)).toContain('permission');
    });

    it('returns a reason for locked fields', () => {
      const reason = getFieldLockReason('locked', true);
      expect(reason).toContain('cannot be modified');
      expect(reason).toContain('breaking integrations');
    });

    it('returns null for operational and editable fields', () => {
      expect(getFieldLockReason('operational', true)).toBeNull();
      expect(getFieldLockReason('editable', true)).toBeNull();
    });
  });
});
