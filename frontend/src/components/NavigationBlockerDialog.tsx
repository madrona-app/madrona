import type { Blocker } from 'react-router-dom';
import ConfirmDialog from './ConfirmDialog';

interface NavigationBlockerDialogProps {
  blocker: Blocker;
}

/**
 * Renders a confirmation dialog when React Router's useBlocker blocks
 * an in-app navigation due to unsaved changes.
 *
 * Usage:
 *   const blocker = useUnsavedGuard(hasUnsavedChanges);
 *   return <NavigationBlockerDialog blocker={blocker} />;
 */
export function NavigationBlockerDialog({ blocker }: NavigationBlockerDialogProps) {
  return (
    <ConfirmDialog
      isOpen={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Unsaved changes"
      message="You have unsaved changes that will be lost if you navigate away. Are you sure you want to leave?"
      confirmText="Leave"
      cancelText="Stay"
      confirmStyle="danger"
    />
  );
}
