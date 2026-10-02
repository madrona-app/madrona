/**
 * Connector icon utilities - maps connector keys to react-icons components.
 */
import React from 'react';
import {
  SiPostgresql,
  SiMysql,
  SiMongodb,
} from 'react-icons/si';
import { FaDatabase, FaPlug, FaCloud } from 'react-icons/fa';
import { MdApi } from 'react-icons/md';
import { DiMsqlServer } from 'react-icons/di';

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

/**
 * Get the appropriate icon component for a connector based on its key or category.
 */
export function getConnectorIcon(key?: string, category?: string): IconComponent {
  // Match by specific connector key
  if (key) {
    switch (key) {
      case 'db-postgres':
        return SiPostgresql;
      case 'db-mysql':
        return SiMysql;
      case 'db-sqlserver':
        return DiMsqlServer;
      case 'db-oracle':
        // Simple Icons dropped the Oracle mark, so react-icons 5.7.0 no longer
        // exports it and no other bundled set carries one. The generic database
        // icon is what the category fallback below would return anyway; kept
        // explicit so this reads as a decision rather than an omission.
        return FaDatabase;
      case 'db-mongodb':
        return SiMongodb;
    }
  }

  // Fall back to category-based icon
  if (category === 'database' || key?.startsWith('db-')) return FaDatabase;
  if (category === 'api') return MdApi;
  if (category === 'cloud') return FaCloud;

  // Default fallback
  return FaPlug;
}

interface ConnectorIconProps {
  /** Connector definition key (e.g., 'db-postgres') */
  connectorKey?: string;
  /** Connector category (e.g., 'database', 'api') */
  category?: string;
  /** Icon size in pixels */
  size?: number;
  /** Additional CSS class */
  className?: string;
}

/**
 * Render a connector icon based on its key or category.
 */
export function ConnectorIcon({
  connectorKey,
  category,
  size = 24,
  className = '',
}: ConnectorIconProps) {
  const Icon = getConnectorIcon(connectorKey, category);
  return <Icon size={size} className={className} />;
}
