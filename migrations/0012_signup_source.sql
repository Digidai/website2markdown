-- Where a new account came from, such as "blocked" for the sign-in hint on a
-- bot-walled page. The portal passes ?ref=... with the magic-link request, the
-- token keeps it, and the account takes it when it is first created.
ALTER TABLE magic_link_tokens ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN signup_source TEXT NOT NULL DEFAULT '';
