-- Seed applied once, at database initialisation, via the image's docker-init.d hook.
-- Runs after docker-init.php has activated the modules named in DOLI_ENABLE_MODULES,
-- and after the SuperAdmin account is created, so the UPDATE below always finds a row.
--
-- Module activation is deliberately NOT done here. Inserting MAIN_MODULE_* rows
-- directly does enable the module, but skips the side effects of activateModule() --
-- notably creating /var/www/documents/api/temp, without which the spec endpoint
-- fails with "Erreur temp dir api/temp not writable". Use DOLI_ENABLE_MODULES.
--
-- NOTE: the entrypoint strips lines beginning with "--" before executing this file,
-- so comments must start at column 0 (they do) and never trail a statement.

-- Fixed API key for the admin user so tests and local runs need no UI clicks.
-- DolibarrApiAccess accepts either the plaintext value or its encrypted form,
-- so storing it in the clear is sufficient. Dev-only credential.
UPDATE llx_user SET api_key = 'dolibarrclidevkey000000000000000' WHERE admin = 1;
