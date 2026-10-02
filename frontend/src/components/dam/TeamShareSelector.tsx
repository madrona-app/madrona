import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Shield, UserPlus, Search, Check } from 'lucide-react';
import { getOrganizationUsers, getRoles } from '../../lib/api';
import { MadronaLoader } from '../ui/MadronaLoader';

type PrincipalType = 'user' | 'role';
type ShareRole = 'viewer' | 'editor';

interface TeamShareSelectorProps {
  organizationId: string;
  onSelect: (principalType: PrincipalType, principalId: string, principalName: string, role: ShareRole) => void;
  disabled?: boolean;
}

interface User {
  user_id: string;
  email: string;
  name?: string | null;
  full_name?: string;
}

interface Role {
  role_id: string;
  role_key: string;
  display_name: string;
  description?: string | null;
}

export function TeamShareSelector({
  organizationId,
  onSelect,
  disabled = false,
}: TeamShareSelectorProps) {
  const [activeTab, setActiveTab] = useState<PrincipalType>('user');
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<ShareRole>('viewer');
  const [selectedPrincipal, setSelectedPrincipal] = useState<{ type: PrincipalType; id: string; name: string } | null>(null);

  // Fetch users
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['org-users', organizationId],
    queryFn: () => getOrganizationUsers(organizationId),
    enabled: activeTab === 'user',
  });

  // Fetch roles
  const { data: rolesData, isLoading: loadingRoles } = useQuery({
    queryKey: ['org-roles', organizationId],
    queryFn: () => getRoles(organizationId),
    enabled: activeTab === 'role',
  });

  const users: User[] = usersData?.users || [];
  const roles: Role[] = rolesData?.roles || [];

  const filteredUsers = users.filter((user) => {
    const searchLower = search.toLowerCase();
    return (
      user.email.toLowerCase().includes(searchLower) ||
      (user.name && user.name.toLowerCase().includes(searchLower)) ||
      (user.full_name && user.full_name.toLowerCase().includes(searchLower))
    );
  });

  const filteredRoles = roles.filter((role) => {
    const searchLower = search.toLowerCase();
    return (
      role.display_name.toLowerCase().includes(searchLower) ||
      role.role_key.toLowerCase().includes(searchLower) ||
      (role.description && role.description.toLowerCase().includes(searchLower))
    );
  });

  const handleSelect = (type: PrincipalType, id: string, name: string) => {
    setSelectedPrincipal({ type, id, name });
  };

  const handleConfirm = () => {
    if (selectedPrincipal) {
      onSelect(selectedPrincipal.type, selectedPrincipal.id, selectedPrincipal.name, selectedRole);
      setSelectedPrincipal(null);
      setSearch('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab Selector */}
      <div className="flex border-b">
        <button
          onClick={() => {
            setActiveTab('user');
            setSelectedPrincipal(null);
          }}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'user'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink'
          }`}
        >
          <UserPlus size={16} />
          Users
        </button>
        <button
          onClick={() => {
            setActiveTab('role');
            setSelectedPrincipal(null);
          }}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'role'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink'
          }`}
        >
          <Shield size={16} />
          Roles
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeTab === 'user' ? 'Search users...' : 'Search roles...'}
          className="input w-full pl-9"
          disabled={disabled}
        />
      </div>

      {/* List */}
      <div className="max-h-48 overflow-y-auto border rounded-lg">
        {activeTab === 'user' ? (
          loadingUsers ? (
            <div className="p-4 text-center">
              <MadronaLoader variant="dots" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-4 text-center text-sm text-archive">
              No users found
            </div>
          ) : (
            <div className="divide-y">
              {filteredUsers.map((user) => (
                <button
                  key={user.user_id}
                  onClick={() => handleSelect('user', user.user_id, user.name || user.email)}
                  disabled={disabled}
                  className={`w-full p-3 text-left hover:bg-stone/30 flex items-center justify-between ${
                    selectedPrincipal?.id === user.user_id ? 'bg-bark/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-stone/50 rounded-full flex items-center justify-center">
                      <Users size={14} className="text-archive" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{user.name || user.full_name || user.email}</p>
                      {user.name && <p className="text-xs text-archive">{user.email}</p>}
                    </div>
                  </div>
                  {selectedPrincipal?.id === user.user_id && (
                    <Check size={16} className="text-bark" />
                  )}
                </button>
              ))}
            </div>
          )
        ) : loadingRoles ? (
          <div className="p-4 text-center">
            <MadronaLoader variant="dots" />
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="p-4 text-center text-sm text-archive">
            No roles found
          </div>
        ) : (
          <div className="divide-y">
            {filteredRoles.map((role) => (
              <button
                key={role.role_id}
                onClick={() => handleSelect('role', role.role_id, role.display_name)}
                disabled={disabled}
                className={`w-full p-3 text-left hover:bg-stone/30 flex items-center justify-between ${
                  selectedPrincipal?.id === role.role_id ? 'bg-bark/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-forest/10 rounded-full flex items-center justify-center">
                    <Shield size={14} className="text-forest" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{role.display_name}</p>
                    {role.description && (
                      <p className="text-xs text-archive truncate max-w-xs">
                        {role.description}
                      </p>
                    )}
                  </div>
                </div>
                {selectedPrincipal?.id === role.role_id && (
                  <Check size={16} className="text-bark" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Role & Confirm */}
      {selectedPrincipal && (
        <div className="flex items-center gap-3 pt-3 border-t">
          <div className="flex-1">
            <label className="block text-xs font-medium text-archive mb-1">
              Permission
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ShareRole)}
              className="input w-full"
              disabled={disabled}
            >
              <option value="viewer">Viewer - Can view</option>
              <option value="editor">Editor - Can edit</option>
            </select>
          </div>
          <button
            onClick={handleConfirm}
            disabled={disabled}
            className="btn btn-primary self-end"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
