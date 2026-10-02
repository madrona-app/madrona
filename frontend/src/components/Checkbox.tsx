import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

const CHECKBOX_CLASSES = 'form-checkbox w-4 h-4 text-bark border-stone rounded focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Additional classes merged with standard styling */
  className?: string;
}

/**
 * Standard Madrona checkbox.
 *
 * Uses the institutional palette: bark accent, lichen border,
 * bark/30 focus ring. All checkboxes in the app should use this
 * component to ensure visual consistency.
 */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(CHECKBOX_CLASSES, className)}
      {...props}
    />
  )
);

Checkbox.displayName = 'Checkbox';

export default Checkbox;
export { CHECKBOX_CLASSES };
