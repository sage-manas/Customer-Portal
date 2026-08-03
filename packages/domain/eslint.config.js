import base from "@cc/config/eslint/base";

/**
 * The registry is the one place a role may be named in a comparison — the
 * plane helpers, the legacy mapping and the tests that assert the table's
 * shape all do it deliberately. Everywhere else `no-restricted-syntax`
 * (packages/config/eslint/base.js) makes it an error; see doc 09 §5.
 */
export default [...base, { files: ["src/**"], rules: { "no-restricted-syntax": "off" } }];
