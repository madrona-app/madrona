/**
 * Object Field Components
 *
 * Complex field components for Collection Object workspace.
 * Each component lives in its own file for maintainability.
 *
 * Usage:
 * ```tsx
 * import { TitlesField, Title, getDisplayTitle } from './ObjectFieldComponents';
 * ```
 */

// Re-export types and constants
export * from './types';

// Re-export helper functions
export * from './helpers';

// Re-export all components from individual files
export { TitlesField } from './TitlesField';
export { ClassificationsField } from './ClassificationsField';
export { MaterialsField } from './MaterialsField';
export { TechniquesField } from './TechniquesField';
export { MeasurementsField } from './MeasurementsField';
export { SubjectsField } from './SubjectsField';
export { CreatorsField } from './CreatorsField';
export { InscriptionsField } from './InscriptionsField';
export { StringListField } from './StringListField';
export { NameListField } from './NameListField';
export { MovementTimeline } from './MovementTimeline';
