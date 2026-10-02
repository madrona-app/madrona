/**
 * API Module Shim
 *
 * This file re-exports everything from the api/ directory barrel.
 * TypeScript/Vite resolves `../../lib/api` to this file (file takes
 * precedence over directory), so all 251+ consumer files continue
 * working with zero import changes.
 *
 * The actual implementations live in api/<domain>.ts modules.
 */
export * from './api/index';
