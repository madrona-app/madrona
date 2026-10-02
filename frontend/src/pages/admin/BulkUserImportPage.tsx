import { useState, useEffect, useRef } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import {
  Upload,
  Users,
  Check,
  X,
  AlertCircle,
  Loader2,
  Download,
  FileSpreadsheet,
  Building2,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface Organization {
  organization_id: string;
  name: string;
  slug: string;
}

interface UserRow {
  email: string;
  name: string;
  role: string;
}

interface ImportResult {
  email: string;
  status: 'created' | 'skipped' | 'error';
  user_id?: string;
  reason?: string;
  note?: string;
  invitation_sent?: boolean;
}

interface ImportResponse {
  message: string;
  organization_id: string;
  results: {
    created: number;
    skipped: number;
    errors: number;
  };
  users: ImportResult[];
}

export default function BulkUserImportPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sendInvitations, setSendInvitations] = useState(true);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResponse | null>(null);

  // Check for platform.admin permission
  const hasPlatformAdmin = user?.permissions?.includes('platform.admin');

  useEffect(() => {
    if (hasPlatformAdmin) {
      loadOrganizations();
    }
  }, [hasPlatformAdmin]);

  // Redirect if not authorized
  if (!hasPlatformAdmin) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const response = await apiFetch<{ organizations: Organization[] }>(
        '/platform/organizations'
      );
      setOrganizations(response.organizations);
    } catch (err) {
      logger.error('Failed to load organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      setError('CSV file is empty');
      return;
    }

    // Check for header row
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('email') || firstLine.includes('name');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parsedUsers: UserRow[] = [];
    const errors: string[] = [];

    dataLines.forEach((line, index) => {
      // Handle both comma and tab separated
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const [email, name, role] = parts.map(p => p.trim().replace(/^["']|["']$/g, ''));

      if (!email || !name) {
        errors.push(`Row ${index + 1}: Missing email or name`);
        return;
      }

      if (!email.includes('@') || !email.includes('.')) {
        errors.push(`Row ${index + 1}: Invalid email format (${email})`);
        return;
      }

      parsedUsers.push({
        email: email.toLowerCase(),
        name,
        role: role?.toLowerCase() === 'admin' ? 'admin' : 'member',
      });
    });

    if (errors.length > 0 && parsedUsers.length === 0) {
      setError(`CSV parsing errors:\n${errors.join('\n')}`);
      return;
    }

    setUsers(parsedUsers);
    setError(null);

    if (errors.length > 0) {
      logger.warn('Some rows had errors:', errors);
    }
  };

  const addManualUser = () => {
    setUsers([...users, { email: '', name: '', role: 'member' }]);
  };

  const updateUser = (index: number, field: keyof UserRow, value: string) => {
    const updated = [...users];
    updated[index] = { ...updated[index], [field]: value };
    setUsers(updated);
  };

  const removeUser = (index: number) => {
    setUsers(users.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    if (!selectedOrgId) {
      setError('Please select an organization');
      return;
    }

    if (users.length === 0) {
      setError('No users to import');
      return;
    }

    // Validate all users
    const invalidUsers = users.filter(u => !u.email || !u.name || !u.email.includes('@'));
    if (invalidUsers.length > 0) {
      setError(`${invalidUsers.length} users have missing or invalid data`);
      return;
    }

    setError(null);
    setImporting(true);

    try {
      const response = await apiFetch<ImportResponse>(
        `/platform/organizations/${selectedOrgId}/users/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            users: users.map(u => ({
              email: u.email.toLowerCase(),
              name: u.name,
              role: u.role,
            })),
            send_invitations: sendInvitations,
          }),
        }
      );

      setResults(response);
    } catch (err) {
      logger.error('Import failed:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template = 'email,name,role\nuser@example.com,John Doe,member\nadmin@example.com,Jane Admin,admin';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setUsers([]);
    setResults(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  // Results view
  if (results) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-parchment rounded-lg border border-lichen p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-semantic-success/10 rounded-full flex items-center justify-center">
              <Check className="w-6 h-6 text-semantic-success" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-ink">Import Complete</h2>
              <p className="text-ink/70">
                {results.results.created} created, {results.results.skipped} skipped, {results.results.errors} errors
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-semantic-success/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-semantic-success">{results.results.created}</div>
              <div className="text-sm text-semantic-success">Created</div>
            </div>
            <div className="bg-semantic-warning/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-semantic-warning">{results.results.skipped}</div>
              <div className="text-sm text-semantic-warning">Skipped</div>
            </div>
            <div className="bg-semantic-error/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-semantic-error">{results.results.errors}</div>
              <div className="text-sm text-semantic-error">Errors</div>
            </div>
          </div>

          {/* Detailed results */}
          <div className="max-h-96 overflow-y-auto border border-lichen rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-parchment sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-ink">Email</th>
                  <th className="text-left px-4 py-2 font-medium text-ink">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-ink">Details</th>
                </tr>
              </thead>
              <tbody>
                {results.users.map((result, idx) => (
                  <tr key={idx} className="border-t border-lichen">
                    <td className="px-4 py-2 text-ink">{result.email}</td>
                    <td className="px-4 py-2">
                      {result.status === 'created' && (
                        <span className="inline-flex items-center gap-1 text-semantic-success">
                          <Check className="w-4 h-4" /> Created
                        </span>
                      )}
                      {result.status === 'skipped' && (
                        <span className="inline-flex items-center gap-1 text-semantic-warning">
                          <AlertCircle className="w-4 h-4" /> Skipped
                        </span>
                      )}
                      {result.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-semantic-error">
                          <X className="w-4 h-4" /> Error
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink/70">
                      {result.reason || result.note || (result.invitation_sent ? 'Invitation sent' : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={resetForm}
              className="px-6 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors"
            >
              Import More Users
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Bulk User Import</h1>
        </div>
        <p className="text-ink/70">
          Import multiple users to an organization via CSV upload or manual entry.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-semantic-error flex-shrink-0 mt-0.5" />
          <div className="text-semantic-error whitespace-pre-wrap">{error}</div>
        </div>
      )}

      <div className="space-y-6">
        {/* Organization Selection */}
        <div className="bg-parchment rounded-lg border border-lichen p-6">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-forest" />
            <h2 className="text-lg font-medium text-ink">Select Organization</h2>
          </div>

          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
          >
            <option value="">Select an organization...</option>
            {organizations.map((org) => (
              <option key={org.organization_id} value={org.organization_id}>
                {org.name} ({org.slug})
              </option>
            ))}
          </select>
        </div>

        {/* CSV Upload */}
        <div className="bg-parchment rounded-lg border border-lichen p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-forest" />
              <h2 className="text-lg font-medium text-ink">Upload CSV</h2>
            </div>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1 text-sm text-forest hover:text-forest/80"
            >
              <Download className="w-4 h-4" />
              Download Template
            </button>
          </div>

          <div
            className="border-2 border-dashed border-lichen rounded-lg p-8 text-center hover:border-forest/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Upload className="w-8 h-8 text-ink/40 mx-auto mb-2" />
            <p className="text-ink/70">Click to upload or drag and drop</p>
            <p className="text-sm text-ink/50">CSV file with columns: email, name, role</p>
          </div>
        </div>

        {/* User List */}
        {users.length > 0 && (
          <div className="bg-parchment rounded-lg border border-lichen p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-forest" />
                <h2 className="text-lg font-medium text-ink">Users to Import ({users.length})</h2>
              </div>
              <button
                onClick={addManualUser}
                className="text-sm text-forest hover:text-forest/80"
              >
                + Add User
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-parchment sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-ink">Email</th>
                    <th className="text-left px-3 py-2 font-medium text-ink">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-ink w-32">Role</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((userRow, idx) => (
                    <tr key={idx} className="border-t border-lichen">
                      <td className="px-3 py-2">
                        <input
                          type="email"
                          value={userRow.email}
                          onChange={(e) => updateUser(idx, 'email', e.target.value)}
                          placeholder="email@example.com"
                          className="w-full px-2 py-1 border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={userRow.name}
                          onChange={(e) => updateUser(idx, 'name', e.target.value)}
                          placeholder="Full Name"
                          className="w-full px-2 py-1 border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={userRow.role}
                          onChange={(e) => updateUser(idx, 'role', e.target.value)}
                          className="w-full px-2 py-1 border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => removeUser(idx)}
                          className="p-1 text-ink/40 hover:text-semantic-error"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Options */}
        {users.length > 0 && (
          <div className="bg-parchment rounded-lg border border-lichen p-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={sendInvitations}
                onChange={(e) => setSendInvitations(e.target.checked)}
              />
              <div>
                <span className="font-medium text-ink">Send invitation emails</span>
                <p className="text-sm text-ink/60">
                  Users will receive an email with a link to set their password
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-4">
          {users.length > 0 && (
            <button
              onClick={resetForm}
              className="px-6 py-2 text-ink/70 hover:text-ink transition-colors"
            >
              Clear All
            </button>
          )}
          <button
            onClick={handleImport}
            disabled={importing || users.length === 0 || !selectedOrgId}
            className="px-6 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import {users.length} Users
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
