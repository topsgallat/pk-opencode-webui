## Issues

- [TIMESTAMP] Issue: settings.tsx runtime ReferenceError when navigating to /settings after moving Global Custom Providers block. Suspected cause: moved JSX references to createSignal values before the signals are declared.

