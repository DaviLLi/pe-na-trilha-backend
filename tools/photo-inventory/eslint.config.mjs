import js from '@eslint/js';
import globals from 'globals';
export default [{ files: ['**/*.js'], ...js.configs.recommended, languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.jest } } }];
