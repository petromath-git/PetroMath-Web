-- Lets an admin deactivate a customer's public onboarding link (e.g. once
-- they're migrated) so a link sent to the wrong customer by mistake exposes
-- nothing. Independent of status (active/setup_done).
ALTER TABLE t_onboarding
    ADD COLUMN link_active CHAR(1) NOT NULL DEFAULT 'Y' AFTER status;
