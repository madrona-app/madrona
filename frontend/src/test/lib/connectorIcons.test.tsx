import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getConnectorIcon, ConnectorIcon } from '../../lib/connectorIcons';
import {
  SiPostgresql,
  SiMysql,
  SiMongodb,
} from 'react-icons/si';
import { FaDatabase, FaPlug, FaCloud } from 'react-icons/fa';
import { MdApi } from 'react-icons/md';
import { DiMsqlServer } from 'react-icons/di';

describe('connectorIcons', () => {
  describe('getConnectorIcon', () => {
    describe('by connector key', () => {
      it('returns PostgreSQL icon for db-postgres', () => {
        expect(getConnectorIcon('db-postgres')).toBe(SiPostgresql);
      });

      it('returns MySQL icon for db-mysql', () => {
        expect(getConnectorIcon('db-mysql')).toBe(SiMysql);
      });

      it('returns SQL Server icon for db-sqlserver', () => {
        expect(getConnectorIcon('db-sqlserver')).toBe(DiMsqlServer);
      });

      it('returns the generic database icon for db-oracle', () => {
        // This asserted the Simple Icons Oracle mark, which react-icons
        // 5.7.0 no longer exports. Both sides were undefined, so it passed
        // while the production build failed on the missing export.
        expect(getConnectorIcon('db-oracle')).toBe(FaDatabase);
      });

      it('returns MongoDB icon for db-mongodb', () => {
        expect(getConnectorIcon('db-mongodb')).toBe(SiMongodb);
      });

    });

    describe('by category', () => {
      it('returns database icon for database category', () => {
        expect(getConnectorIcon(undefined, 'database')).toBe(FaDatabase);
      });

      it('returns API icon for api category', () => {
        expect(getConnectorIcon(undefined, 'api')).toBe(MdApi);
      });

      it('returns cloud icon for cloud category', () => {
        expect(getConnectorIcon(undefined, 'cloud')).toBe(FaCloud);
      });
    });

    describe('fallback behavior', () => {
      it('returns database icon for unknown db- prefixed key', () => {
        expect(getConnectorIcon('db-unknown')).toBe(FaDatabase);
      });

      it('returns plug icon for unknown key and category', () => {
        expect(getConnectorIcon('unknown-connector')).toBe(FaPlug);
      });

      it('returns plug icon when no key or category provided', () => {
        expect(getConnectorIcon()).toBe(FaPlug);
      });

      it('returns plug icon for undefined key and undefined category', () => {
        expect(getConnectorIcon(undefined, undefined)).toBe(FaPlug);
      });
    });
  });

  describe('ConnectorIcon component', () => {
    it('renders with default size', () => {
      const { container } = render(<ConnectorIcon connectorKey="db-postgres" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('renders with custom size', () => {
      const { container } = render(<ConnectorIcon connectorKey="db-postgres" size={32} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      // Size is passed as prop to the icon
    });

    it('renders with custom className', () => {
      const { container } = render(
        <ConnectorIcon connectorKey="db-postgres" className="custom-class" />
      );
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('custom-class');
    });

    it('renders correct icon for connector key', () => {
      const { container: postgresContainer } = render(
        <ConnectorIcon connectorKey="db-postgres" />
      );
      const { container: mysqlContainer } = render(
        <ConnectorIcon connectorKey="db-mysql" />
      );

      // Both should render SVGs
      expect(postgresContainer.querySelector('svg')).toBeInTheDocument();
      expect(mysqlContainer.querySelector('svg')).toBeInTheDocument();
    });

    it('renders correct icon for category', () => {
      const { container } = render(<ConnectorIcon category="api" />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('prefers key over category when both provided', () => {
      // db-postgres should take precedence over api category
      const { container } = render(
        <ConnectorIcon connectorKey="db-postgres" category="api" />
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders fallback icon when no props provided', () => {
      const { container } = render(<ConnectorIcon />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });
});
