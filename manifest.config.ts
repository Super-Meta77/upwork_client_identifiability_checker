import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// NFR-09: only storage, sidePanel and scripting, and host access to www.upwork.com.
// D-30: the job-details token is pasted in Settings and kept in session memory; no cookies, no
// webRequest. D-31: `scripting` lets the panel search again and read the job links in the search tab
// the user is watching, only during a round; there is no content script.
export default defineManifest({
  manifest_version: 3,
  name: 'Upwork Client Identifiability Checker',
  short_name: 'Client Checker',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '120',
  permissions: ['storage', 'sidePanel', 'scripting'],
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
