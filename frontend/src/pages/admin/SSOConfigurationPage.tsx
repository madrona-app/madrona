import { useState, useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  Shield,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Copy,
  RefreshCw,
  Building2,
  Key,
  Globe,
  Users,
  X,
  Plus,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

interface AvailableRole {
  role_id: string;
  role_key: string;
  display_name: string;
}

interface EnabledApp {
  app_key: string;
  display_name: string;
}

interface SSOConfig {
  id: string;
  provider: 'saml' | 'oidc';
  enabled: boolean;
  idp_entity_id: string | null;
  idp_sso_url: string | null;
  idp_certificate: string | null;
  sp_entity_id: string | null;
  client_id: string | null;
  discovery_url: string | null;
  auto_provision_users: boolean;
  default_app_roles: Record<string, string>;
  allowed_domains: string[];
  created_at: string | null;
  updated_at: string | null;
}

interface SPMetadata {
  entity_id: string;
  acs_url: string;
}

interface Organization {
  organization_id: string;
  name: string;
}

interface SSOResponse {
  organization_id: string;
  organization_name: string;
  sso_config: SSOConfig | null;
  sp_metadata: SPMetadata;
  available_roles: AvailableRole[];
  enabled_apps: EnabledApp[];
}

interface TestResult {
  success: boolean;
  message: string;
  details: {
    certificate_valid: boolean;
    certificate_expires: string | null;
    certificate_error: string | null;
    idp_reachable: boolean | null;
  };
}

export default function SSOConfigurationPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(orgId || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [ssoConfig, setSSOConfig] = useState<SSOConfig | null>(null);
  const [spMetadata, setSPMetadata] = useState<SPMetadata | null>(null);
  const [availableRoles, setAvailableRoles] = useState<AvailableRole[]>([]);
  const [enabledApps, setEnabledApps] = useState<EnabledApp[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Form state
  const [provider, setProvider] = useState<'saml' | 'oidc'>('saml');
  const [enabled, setEnabled] = useState(false);
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCertificate, setIdpCertificate] = useState('');
  const [autoProvisionUsers, setAutoProvisionUsers] = useState(true);
  const [defaultAppRoles, setDefaultAppRoles] = useState<Record<string, string>>({});
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const hasPlatformAdmin = user?.permissions?.includes('platform.admin');

  // Load organizations list for platform admins
  useEffect(() => {
    if (hasPlatformAdmin) {
      loadOrganizations();
    }
  }, [hasPlatformAdmin]);

  // Load SSO config when org is selected.
  //
  // Guarded on hasPlatformAdmin as well as the id. Without it, a user who is not
  // a platform admin — the common case for anyone who reaches this URL — fired a
  // request they are not allowed to make, and worse: the component returns early
  // below, before the loader declarations, so this effect reached loadSSOConfig
  // in its temporal dead zone and threw
  //
  //     ReferenceError: Cannot access 'A' before initialization
  //
  // The error boundary caught it and the page rendered blank, so the Navigate
  // redirect a few lines down never ran. The loaders are hoisted function
  // declarations now, which removes the dead zone regardless of this guard.
  useEffect(() => {
    if (hasPlatformAdmin && selectedOrgId) {
      loadSSOConfig(selectedOrgId);
    }
  }, [hasPlatformAdmin, selectedOrgId]);

  if (!hasPlatformAdmin) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  async function loadOrganizations() {
    try {
      const response = await apiFetch<{ organizations: Organization[] }>('/platform/organizations', { expectKeys: ['organizations'] });
      const orgs = response.organizations || [];
      setOrganizations(orgs);
      if (!selectedOrgId && orgs.length > 0) {
        setSelectedOrgId(orgId || orgs[0].organization_id);
      }
    } catch (err) {
      logger.error('Failed to load organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    }
  };

  async function loadSSOConfig(orgId: string) {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch<SSOResponse>(`/platform/organizations/${orgId}/sso`);
      setSSOConfig(response.sso_config);
      setSPMetadata(response.sp_metadata);
      setAvailableRoles(response.available_roles);
      setEnabledApps(response.enabled_apps || []);

      // Populate form
      if (response.sso_config) {
        setProvider(response.sso_config.provider);
        setEnabled(response.sso_config.enabled);
        setIdpEntityId(response.sso_config.idp_entity_id || '');
        setIdpSsoUrl(response.sso_config.idp_sso_url || '');
        setIdpCertificate(response.sso_config.idp_certificate || '');
        setAutoProvisionUsers(response.sso_config.auto_provision_users);
        setDefaultAppRoles(response.sso_config.default_app_roles || {});
        setAllowedDomains(response.sso_config.allowed_domains || []);
      } else {
        // Reset form for new config
        setProvider('saml');
        setEnabled(false);
        setIdpEntityId('');
        setIdpSsoUrl('');
        setIdpCertificate('');
        setAutoProvisionUsers(true);
        setDefaultAppRoles({});
        setAllowedDomains([]);
      }
    } catch (err) {
      logger.error('Failed to load SSO config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load SSO configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedOrgId) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await apiFetch(`/platform/organizations/${selectedOrgId}/sso`, {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          enabled,
          idp_entity_id: idpEntityId || null,
          idp_sso_url: idpSsoUrl || null,
          idp_certificate: idpCertificate || null,
          auto_provision_users: autoProvisionUsers,
          default_app_roles: Object.keys(defaultAppRoles).length > 0 ? defaultAppRoles : null,
          allowed_domains: allowedDomains.length > 0 ? allowedDomains : null,
        }),
      });

      setSuccessMessage('SSO configuration saved successfully');
      await loadSSOConfig(selectedOrgId);
    } catch (err) {
      logger.error('Failed to save SSO config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save SSO configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedOrgId) return;

    try {
      setTesting(true);
      setTestResult(null);

      const response = await apiFetch<TestResult>(`/platform/organizations/${selectedOrgId}/sso/test`, {
        method: 'POST',
        body: JSON.stringify({
          idp_entity_id: idpEntityId,
          idp_sso_url: idpSsoUrl,
          idp_certificate: idpCertificate,
        }),
      });

      setTestResult(response);
    } catch (err: unknown) {
      // API returns 400 with test result on failure
      if (err && typeof err === 'object' && 'response' in err) {
        const errWithResponse = err as { response?: { json?: () => Promise<TestResult> } };
        if (errWithResponse.response?.json) {
          const data = await errWithResponse.response.json();
          setTestResult(data);
          return;
        }
      }
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
        details: {
          certificate_valid: false,
          certificate_expires: null,
          certificate_error: 'Unknown error',
          idp_reachable: null,
        },
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedOrgId || !ssoConfig) return;

    setConfirmState({
      action: async () => {
        try {
          setSaving(true);
          setError(null);

          await apiFetch(`/platform/organizations/${selectedOrgId}/sso`, {
            method: 'DELETE',
          });

          setSuccessMessage('SSO configuration deleted');
          await loadSSOConfig(selectedOrgId);
        } catch (err) {
          logger.error('Failed to delete SSO config:', err);
          setError(err instanceof Error ? err.message : 'Failed to delete SSO configuration');
        } finally {
          setSaving(false);
        }
      },
      title: 'Delete SSO Configuration',
      message: 'Are you sure you want to delete the SSO configuration? This cannot be undone.',
    });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for contexts where clipboard API is not available (e.g., non-secure, no user gesture)
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const addDomain = () => {
    const domain = newDomain.trim().toLowerCase();
    if (domain && !allowedDomains.includes(domain)) {
      setAllowedDomains([...allowedDomains, domain]);
      setNewDomain('');
    }
  };

  const removeDomain = (domain: string) => {
    setAllowedDomains(allowedDomains.filter((d) => d !== domain));
  };

  if (loading && !organizations.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">SSO Configuration</h1>
        </div>
        <p className="text-ink/70">
          Configure SAML or OIDC single sign-on for enterprise customers.
        </p>
      </div>

      {/* Organization Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-ink mb-2">
          <Building2 className="w-4 h-4 inline mr-2" />
          Organization
        </label>
        <select
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
          className="w-full max-w-md px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
        >
          <option value="">Select an organization...</option>
          {organizations.map((org) => (
            <option key={org.organization_id} value={org.organization_id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-semantic-error hover:text-semantic-error">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-semantic-success/10 border border-semantic-success/30 rounded-lg text-semantic-success flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {successMessage}
          <button onClick={() => setSuccessMessage(null)} className="ml-auto text-semantic-success hover:text-semantic-success">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {selectedOrgId && !loading && (
        <>
          {/* Provider Tabs */}
          <div className="mb-6">
            <div className="border-b border-lichen">
              <nav className="-mb-px flex gap-4">
                <button
                  onClick={() => setProvider('saml')}
                  className={`py-3 px-1 border-b-2 font-medium text-sm ${
                    provider === 'saml'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-ink/60 hover:text-ink hover:border-lichen'
                  }`}
                >
                  SAML 2.0
                </button>
                <button
                  onClick={() => setProvider('oidc')}
                  className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                    provider === 'oidc'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-ink/60 hover:text-ink hover:border-lichen'
                  }`}
                >
                  OIDC
                  <span className="px-2 py-0.5 text-xs rounded-full bg-semantic-warning/10 text-semantic-warning">
                    Coming Soon
                  </span>
                </button>
              </nav>
            </div>
          </div>

          {/* SP Metadata (Show to customer for IdP setup) */}
          {spMetadata && (
            <div className="mb-6 p-4 bg-parchment rounded-lg border border-lichen">
              <h3 className="text-sm font-medium text-ink mb-3">Service Provider Metadata</h3>
              <p className="text-sm text-ink/70 mb-4">
                Provide these values to your Identity Provider administrator:
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-ink/50 block mb-1">Entity ID (Issuer)</label>
                    <div className="flex items-center gap-2">
                      <code className="text-sm bg-parchment px-2 py-1 rounded border border-lichen flex-1 break-all">
                        {spMetadata.entity_id}
                      </code>
                      <button
                        onClick={() => copyToClipboard(spMetadata.entity_id)}
                        className="p-1 hover:bg-lichen rounded"
                        title="Copy"
                      >
                        <Copy className="w-4 h-4 text-ink/50" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-ink/50 block mb-1">ACS URL (Reply URL)</label>
                    <div className="flex items-center gap-2">
                      <code className="text-sm bg-parchment px-2 py-1 rounded border border-lichen flex-1 break-all">
                        {spMetadata.acs_url}
                      </code>
                      <button
                        onClick={() => copyToClipboard(spMetadata.acs_url)}
                        className="p-1 hover:bg-lichen rounded"
                        title="Copy"
                      >
                        <Copy className="w-4 h-4 text-ink/50" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SAML Configuration Form */}
          {provider === 'saml' && (
            <div className="bg-parchment rounded-lg border border-lichen p-6 mb-6">
              <h3 className="text-lg font-medium text-ink mb-4 flex items-center gap-2">
                <Key className="w-5 h-5" />
                Identity Provider Settings
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    IdP Entity ID *
                  </label>
                  <input
                    type="text"
                    value={idpEntityId}
                    onChange={(e) => setIdpEntityId(e.target.value)}
                    placeholder="https://idp.example.com/metadata"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    The unique identifier of your Identity Provider
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    IdP SSO URL *
                  </label>
                  <input
                    type="url"
                    value={idpSsoUrl}
                    onChange={(e) => setIdpSsoUrl(e.target.value)}
                    placeholder="https://idp.example.com/sso/saml"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    The URL where authentication requests are sent
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    IdP Certificate (PEM format) *
                  </label>
                  <textarea
                    value={idpCertificate}
                    onChange={(e) => setIdpCertificate(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    rows={6}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest font-mono text-sm"
                  />
                  <p className="text-xs text-ink/50 mt-1">
                    The X.509 certificate from your Identity Provider
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* OIDC Configuration (Coming Soon) */}
          {provider === 'oidc' && (
            <div className="bg-parchment rounded-lg border border-lichen p-6 mb-6">
              <div className="text-center py-8">
                <Globe className="w-12 h-12 text-ink/30 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-ink mb-2">OpenID Connect</h3>
                <p className="text-ink/60">
                  OIDC support is coming soon. Please use SAML 2.0 for now.
                </p>
              </div>
            </div>
          )}

          {/* User Provisioning Settings */}
          <div className="bg-parchment rounded-lg border border-lichen p-6 mb-6">
            <h3 className="text-lg font-medium text-ink mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              User Provisioning
            </h3>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="autoProvision"
                  checked={autoProvisionUsers}
                  onChange={(e) => setAutoProvisionUsers(e.target.checked)}
                />
                <label htmlFor="autoProvision" className="text-sm text-ink">
                  Auto-provision users on first SSO login
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Default Roles for New Users (per App)
                </label>
                <p className="text-xs text-ink/50 mb-3">
                  Set the default role for each enabled application. Users provisioned via SSO will receive these roles.
                </p>
                {enabledApps.length > 0 ? (
                  <div className="border border-lichen rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-parchment">
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-medium text-ink">Application</th>
                          <th className="px-4 py-2 text-left text-sm font-medium text-ink">Default Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enabledApps.map((app) => (
                          <tr key={app.app_key} className="border-t border-lichen">
                            <td className="px-4 py-3 text-sm text-ink">{app.display_name}</td>
                            <td className="px-4 py-2">
                              <select
                                value={defaultAppRoles[app.app_key] || ''}
                                onChange={(e) =>
                                  setDefaultAppRoles((prev) => ({
                                    ...prev,
                                    [app.app_key]: e.target.value,
                                  }))
                                }
                                className="w-full max-w-xs px-3 py-1.5 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest text-sm"
                              >
                                <option value="">No access</option>
                                {availableRoles.map((role) => (
                                  <option key={role.role_key} value={role.role_key}>
                                    {role.display_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-ink/60 italic">
                    No applications enabled for this organization. Enable apps first to configure default roles.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Allowed Email Domains
                </label>
                <p className="text-xs text-ink/50 mb-2">
                  Only users with email addresses from these domains can sign in via SSO
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {allowedDomains.map((domain) => (
                    <span
                      key={domain}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-lichen/30 rounded text-sm"
                    >
                      @{domain}
                      <button
                        onClick={() => removeDomain(domain)}
                        className="text-ink/50 hover:text-semantic-error"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())}
                    placeholder="example.com"
                    className="flex-1 max-w-xs px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                  />
                  <button
                    type="button"
                    onClick={addDomain}
                    className="px-3 py-2 border border-lichen rounded-lg hover:bg-lichen/20"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Enable/Disable Toggle */}
          <div className="bg-parchment rounded-lg border border-lichen p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-ink">Enable SSO</h3>
                <p className="text-sm text-ink/60">
                  When enabled, users from allowed domains will be redirected to SSO login
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-lichen peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-parchment after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-parchment after:border-lichen after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-forest"></div>
              </label>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`mb-6 p-4 rounded-lg border ${
                testResult.success
                  ? 'bg-semantic-success/10 border-semantic-success/30'
                  : 'bg-semantic-warning/10 border-semantic-warning/30'
              }`}
            >
              <div className="flex items-start gap-3">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5 text-semantic-success mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-semantic-warning mt-0.5" />
                )}
                <div>
                  <p className={`font-medium ${testResult.success ? 'text-semantic-success' : 'text-semantic-warning'}`}>
                    {testResult.message}
                  </p>
                  <div className="mt-2 text-sm space-y-1">
                    <p className={testResult.details.certificate_valid ? 'text-semantic-success' : 'text-semantic-warning'}>
                      Certificate: {testResult.details.certificate_valid ? 'Valid' : 'Invalid'}
                      {testResult.details.certificate_expires &&
                        ` (expires ${formatDateShort(testResult.details.certificate_expires)})`}
                      {testResult.details.certificate_error && ` - ${testResult.details.certificate_error}`}
                    </p>
                    {testResult.details.idp_reachable !== null && (
                      <p className={testResult.details.idp_reachable ? 'text-semantic-success' : 'text-semantic-warning'}>
                        IdP Connectivity: {testResult.details.idp_reachable ? 'Reachable' : 'Not reachable'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saving || provider === 'oidc'}
              className="px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Configuration'
              )}
            </button>

            <button
              onClick={handleTest}
              disabled={testing || !idpCertificate || provider === 'oidc'}
              className="px-4 py-2 border border-lichen rounded-lg hover:bg-lichen/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Test Connection
                </>
              )}
            </button>

            {ssoConfig && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 text-semantic-error hover:bg-semantic-error/20 rounded-lg disabled:opacity-50"
              >
                Delete Configuration
              </button>
            )}
          </div>
        </>
      )}

      {loading && selectedOrgId && (
        <div className="flex items-center justify-center py-12">
          <MadronaLoader />
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </div>
  );
}
