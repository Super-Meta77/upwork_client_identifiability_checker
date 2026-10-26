import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// NFR-09: only storage, cookies, sidePanel and scripting, and host access to www.upwork.com.
// D-30: the scoped job-details token is supplied by manual entry (Settings), kept in session memory;
// no webRequest. D-31: `scripting` lets the panel read the job links of the search tab the user is
// watching, only after they press Run; there is no content script. An attachment host is added here
// only if Phase 0 shows it differs (see docs/decisions.md).
export default defineManifest({
  manifest_version: 3,
  name: 'Upwork Client Identifiability Checker',
  short_name: 'Client Checker',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '120',
  permissions: ['storage', 'cookies', 'sidePanel', 'scripting'],
  host_permissions: ['https://www.upwork.com/*'],
  background: {
    service_worker: 'src/background/sw.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/panel/index.html',
  },
  action: {
    default_title: 'Open the Client Identifiability Checker',
  },
});
